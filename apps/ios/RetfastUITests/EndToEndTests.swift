import XCTest

/// Opt-in end-to-end checks against a locally running backend. Skipped unless
/// `TEST_RUNNER_RETFAST_E2E_BASE_URL` (and credentials) are set, e.g.:
///
///     xcrun simctl privacy <udid> grant location-always com.mizibu.retfast
///     xcrun simctl location <udid> start --speed=10 <lat,lon> <lat,lon> ...
///     TEST_RUNNER_RETFAST_E2E_BASE_URL=http://localhost:8082 \
///     TEST_RUNNER_RETFAST_E2E_EMAIL=emre@retfast.com \
///     TEST_RUNNER_RETFAST_E2E_PASSWORD=password \
///     TEST_RUNNER_RETFAST_E2E_NEW_PASSWORD='...' \
///     TEST_RUNNER_RETFAST_E2E_RETRIEVER_EMAIL=kubra@retfast.com \
///     TEST_RUNNER_RETFAST_E2E_RETRIEVER_PASSWORD=password \
///     xcodebuild test -scheme Retfast -only-testing:RetfastUITests/EndToEndTests ...
///
/// `testA` (pilot) records a flight in the demo event, ends it and requests a
/// retrieve; `testB` (retriever) accepts it, marks picked up and delivered.
/// Simulator only: proves the wiring (auth → forced password change → flight →
/// SQLite → batches → retrieval outbox → server), not real-device GPS,
/// background behaviour or battery.
@MainActor
final class EndToEndTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUp() async throws { continueAfterFailure = false }

    private func launch(base: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"]
        app.launchEnvironment["RETFAST_API_BASE_URL"] = base
        app.launch()
        app.completeOnboarding()
        return app
    }

    private func signIn(_ app: XCUIApplication, email: String, password: String, newPassword: String) {
        app.login(email: email, password: password)
        // Forced password change (bootstrap accounts).
        let current = app.secureTextFields["password.current"]
        if current.waitForExistence(timeout: 10) {
            current.tap(); current.typeText(password)
            let n = app.secureTextFields["password.new"]; n.tap(); n.typeText(newPassword)
            let c = app.secureTextFields["password.confirm"]; c.tap(); c.typeText(newPassword)
            app.buttons["password.submit"].tap()
        }
    }

    private func openDemoEvent(_ app: XCUIApplication) {
        let row = app.descendants(matching: .any)["events.row.cameli-paragliding-demo"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "events not reached")
        row.tap()
    }

    func testA_PilotFlightEndAndRetrieveRequest() throws {
        guard let base = env["RETFAST_E2E_BASE_URL"], let email = env["RETFAST_E2E_EMAIL"],
              let password = env["RETFAST_E2E_PASSWORD"] else { throw XCTSkip("RETFAST_E2E_* not set") }
        let recordSeconds = Double(env["RETFAST_E2E_RECORD_SECONDS"] ?? "45") ?? 45
        let app = launch(base: base)
        signIn(app, email: email, password: password, newPassword: env["RETFAST_E2E_NEW_PASSWORD"] ?? "Yamac-Ucus-2026-e2e")
        openDemoEvent(app)

        // Full-screen pre-flight checklist first, then the pilot sheet.
        let next = app.buttons["preflight.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 10), "pre-flight screen not shown")
        next.tap()
        let start = app.buttons["pilot.start"]
        app.reveal(start)
        start.tap()

        let state = app.descendants(matching: .any)["fc.state"]
        XCTAssertTrue(state.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS[c] 'Recording' OR label CONTAINS[c] 'Kaydediliyor'"), evaluatedWith: state)
        waitForExpectations(timeout: 60)

        // Leaving the event screen must not stop recording.
        app.buttons["event.back"].tap()
        let resume = app.descendants(matching: .any)["activity.flight"].firstMatch
        XCTAssertTrue(resume.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: recordSeconds)
        resume.tap()

        let end = app.buttons["fc.end"]
        app.reveal(end)
        end.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "(label == 'End flight' OR label == 'Uçuşu bitir') AND identifier != 'pilot.end'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        app.settleAndTap(confirm)

        let chip = app.buttons["retrieve.chip.0"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        chip.tap()
        let send = app.buttons["retrieve.send"]
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: send)
        waitForExpectations(timeout: 20)
        send.tap()

        // Server confirmed the request (stage leaves saved_locally/sending).
        let stage = app.descendants(matching: .any)["retrieval.stage"].firstMatch
        XCTAssertTrue(stage.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "value == 'requested' OR value == 'accepted'"), evaluatedWith: stage)
        waitForExpectations(timeout: 30)
        // Let the sync engine upload the tail, close the flight and share a position.
        Thread.sleep(forTimeInterval: 40)
    }

    func testB_RetrieverAcceptsPicksUpAndDelivers() throws {
        guard let base = env["RETFAST_E2E_BASE_URL"], let email = env["RETFAST_E2E_RETRIEVER_EMAIL"],
              let password = env["RETFAST_E2E_RETRIEVER_PASSWORD"] else { throw XCTSkip("RETFAST_E2E_RETRIEVER_* not set") }
        let app = launch(base: base)
        signIn(app, email: email, password: password, newPassword: env["RETFAST_E2E_RETRIEVER_NEW_PASSWORD"] ?? "Toplama-Araci-2026-e2e")
        openDemoEvent(app)

        let picked = app.buttons["retriever.pickedUp"]
        let accept = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'retriever.accept.'")).firstMatch
        if !picked.waitForExistence(timeout: 8) {
            app.reveal(accept)
            accept.tap()
        }
        app.reveal(picked)
        // The pilot's live/pickup position is visible to the accepting retriever.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pilot konumu' OR label BEGINSWITH 'Pilot position'")).firstMatch
            .waitForExistence(timeout: 20), "pilot position not shown to the retriever")
        Thread.sleep(forTimeInterval: 20)  // let duty/position sharing post at least once
        picked.tap()

        let delivered = app.buttons["retriever.delivered"]
        app.reveal(delivered)
        delivered.tap()
        let confirm = app.buttons["retriever.deliveredConfirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(delivered.waitForNonExistence(timeout: 15), "pickup still listed after delivery")
    }
}
