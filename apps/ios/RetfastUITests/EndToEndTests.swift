import XCTest

/// Opt-in end-to-end check against a locally running backend. Skipped unless
/// `TEST_RUNNER_RETFAST_E2E_BASE_URL` (and credentials) are set, e.g.:
///
///     xcrun simctl privacy <udid> grant location-always com.mizibu.retfast
///     xcrun simctl location <udid> start --speed=10 <lat,lon> <lat,lon> ...
///     TEST_RUNNER_RETFAST_E2E_BASE_URL=http://localhost:8081 \
///     TEST_RUNNER_RETFAST_E2E_EMAIL=tecelli@retfast.com \
///     TEST_RUNNER_RETFAST_E2E_PASSWORD=password \
///     TEST_RUNNER_RETFAST_E2E_NEW_PASSWORD='...' \
///     xcodebuild test -scheme Retfast -only-testing:RetfastUITests/EndToEndTests ...
///
/// Simulator only: proves the wiring (auth → forced password change → flight →
/// SQLite → batches → server), not real-device GPS/background behaviour.
@MainActor
final class EndToEndTests: XCTestCase {
    func testLoginForcedPasswordChangeAndRecordFlight() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let base = env["RETFAST_E2E_BASE_URL"], let email = env["RETFAST_E2E_EMAIL"],
              let password = env["RETFAST_E2E_PASSWORD"] else {
            throw XCTSkip("RETFAST_E2E_* not set")
        }
        let recordSeconds = Double(env["RETFAST_E2E_RECORD_SECONDS"] ?? "45") ?? 45
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"]
        app.launchEnvironment["RETFAST_API_BASE_URL"] = base
        app.launch()

        // Onboarding.
        app.completeOnboarding()

        // Login.
        let emailField = app.textFields["login.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 15))
        emailField.tap(); emailField.typeText(email)
        let pw = app.secureTextFields["login.password"]
        pw.tap(); pw.typeText(password)
        app.buttons["login.submit"].tap()

        // Forced password change (bootstrap accounts).
        let current = app.secureTextFields["password.current"]
        if current.waitForExistence(timeout: 10) {
            let newPassword = env["RETFAST_E2E_NEW_PASSWORD"] ?? "Yamac-Ucus-2026-e2e"
            current.tap(); current.typeText(password)
            let n = app.secureTextFields["password.new"]; n.tap(); n.typeText(newPassword)
            let c = app.secureTextFields["password.confirm"]; c.tap(); c.typeText(newPassword)
            app.buttons["password.submit"].tap()
        }

        // Home → pre-flight → start.
        let start = app.buttons["home.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 20), "Home not reached")
        start.tap()
        let startFlight = app.buttons["preflight.start"]
        for _ in 0..<6 where !startFlight.isHittable { app.swipeUp() }
        XCTAssertTrue(startFlight.waitForExistence(timeout: 5))
        startFlight.tap()

        // Flight computer: wait for recording with simulated fixes.
        let state = app.descendants(matching: .any)["fc.state"]
        XCTAssertTrue(state.waitForExistence(timeout: 10))
        let recording = NSPredicate(format: "label CONTAINS[c] 'Recording' OR label CONTAINS[c] 'Kaydediliyor'")
        expectation(for: recording, evaluatedWith: state)
        waitForExpectations(timeout: 60)

        // Leaving the flight screen must not stop recording.
        app.buttons["fc.minimize"].tap()
        XCTAssertTrue(app.buttons["home.resume"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: recordSeconds)
        app.buttons["home.resume"].tap()

        app.buttons["fc.end"].tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'End flight' OR label == 'Uçuşu bitir'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        let summary = app.staticTexts.matching(NSPredicate(format: "label == 'Flight saved' OR label == 'Uçuş kaydedildi'")).firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10), "Flight summary not shown")
        // Give the sync engine time to upload the tail and close the flight.
        Thread.sleep(forTimeInterval: 15)
    }
}
