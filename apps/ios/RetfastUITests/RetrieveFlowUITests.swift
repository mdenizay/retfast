import XCTest

/// Pilot flow against the in-app stub backend (`-stubAPI`) and a synthetic
/// location source (`-stubLocation`): event sheet → start flight → end →
/// retrieve request → waiting screen shows the stub's acceptance.
/// Proves UI wiring only; not real GPS, background or network behaviour.
@MainActor
final class RetrieveFlowUITests: XCTestCase {
    override func setUp() async throws { continueAfterFailure = false }

    func testPilotStartEndAndRequestRetrieve() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-stubAPI", "-stubLocation"]
        app.launch()

        app.completeOnboarding()
        app.login(email: "pilot@stub.local", password: "anything-long")

        // Events tab → the demo event (pilot role).
        let row = app.descendants(matching: .any)["events.row.cameli-paragliding-demo"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "event list not shown")
        row.tap()

        // Full-screen pre-flight checklist first, then the pilot sheet.
        let next = app.buttons["preflight.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 10), "pre-flight screen not shown")
        next.tap()
        let start = app.buttons["pilot.start"]
        app.reveal(start)
        XCTAssertTrue(start.isEnabled, "start must be enabled")
        start.tap()

        // The flight runs in the event sheet: recording with simulated fixes.
        let state = app.descendants(matching: .any)["fc.state"]
        XCTAssertTrue(state.waitForExistence(timeout: 10))
        let recording = NSPredicate(format: "label CONTAINS[c] 'Recording' OR label CONTAINS[c] 'Kaydediliyor'")
        expectation(for: recording, evaluatedWith: state)
        waitForExpectations(timeout: 20)

        // End the flight.
        let end = app.buttons["fc.end"]
        app.reveal(end)
        end.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "(label == 'End flight' OR label == 'Uçuşu bitir') AND identifier != 'pilot.end'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        app.settleAndTap(confirm)

        // Ending opens the retrieve request directly.
        let chip = app.buttons["retrieve.chip.0"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        chip.tap()
        let send = app.buttons["retrieve.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        let enabled = NSPredicate(format: "isEnabled == true")
        expectation(for: enabled, evaluatedWith: send)
        waitForExpectations(timeout: 10)
        send.tap()

        // Waiting screen: request delivered, then accepted by the stub retriever.
        let stage = app.descendants(matching: .any)["retrieval.stage"].firstMatch
        XCTAssertTrue(stage.waitForExistence(timeout: 10), "waiting screen not shown")
        expectation(for: NSPredicate(format: "value == 'accepted'"), evaluatedWith: stage)
        waitForExpectations(timeout: 30)
        XCTAssertTrue(app.buttons["retrieval.call"].waitForExistence(timeout: 5), "call button for the retriever missing")

        // Minimise: the resume bar above the tab bar brings it back.
        app.buttons["retrieval.minimize"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["activity.retrieval"].firstMatch.waitForExistence(timeout: 5), "resume bar missing")
    }

    /// End without a retrieve: the "flight complete" screen, then back to home.
    func testEndFlightShowsCompletionThenHome() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-stubAPI", "-stubLocation"]
        app.launch()

        app.completeOnboarding()
        app.login(email: "pilot@stub.local", password: "anything-long")

        let row = app.descendants(matching: .any)["events.row.cameli-paragliding-demo"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "event list not shown")
        row.tap()
        let next = app.buttons["preflight.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 10))
        next.tap()
        XCTAssertTrue(app.descendants(matching: .any)["pilot.myLocation"].firstMatch.waitForExistence(timeout: 10), "own location row missing")
        let start = app.buttons["pilot.start"]
        app.reveal(start)
        start.tap()

        let end = app.buttons["fc.end"]
        app.reveal(end)
        app.settleAndTap(end)
        let confirm = app.buttons.matching(NSPredicate(format: "(label == 'End flight' OR label == 'Uçuşu bitir') AND identifier != 'pilot.end'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        app.settleAndTap(confirm)

        // Retrieve request opens over the completion screen; skip it.
        let skip = app.buttons["retrieve.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 10), "retrieve request not shown")
        app.settleAndTap(skip)

        XCTAssertTrue(app.descendants(matching: .any)["summary.title"].firstMatch.waitForExistence(timeout: 10), "completion screen not shown")
        if let dir = ProcessInfo.processInfo.environment["TOUR_DIR"], !dir.isEmpty {
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("tour_completed.png"))
        }
        let home = app.buttons["summary.done"]
        XCTAssertTrue(home.exists)
        home.tap()
        XCTAssertTrue(app.descendants(matching: .any)["events.row.cameli-paragliding-demo"].firstMatch.waitForExistence(timeout: 10), "not back on the home screen")
        XCTAssertFalse(app.buttons["preflight.next"].exists, "should be on home, not inside the event")
    }
}

extension XCUIApplication {
    @MainActor func login(email: String, password: String, file: StaticString = #filePath, line: UInt = #line) {
        if buttons["onboarding.next"].waitForExistence(timeout: 5) { completeOnboarding(file: file, line: line) }
        let viaEmail = buttons["auth.email"]
        if viaEmail.waitForExistence(timeout: 10) { viaEmail.tap() }
        let emailField = textFields["login.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), file: file, line: line)
        emailField.tap(); emailField.typeText(email)
        let pw = secureTextFields["login.password"]
        pw.tap(); pw.typeText(password)
        buttons["login.submit"].tap()
    }

    /// The app never idles while recording (2 Hz fixes, ticking timers), so
    /// XCTest cannot wait for quiescence: let popover animations finish first.
    @MainActor func settleAndTap(_ element: XCUIElement) {
        Thread.sleep(forTimeInterval: 1.0)
        element.tap()
    }

    /// Scrolls the bottom sheet / list until the element is hittable.
    @MainActor func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 15), "\(element) not found", file: file, line: line)
        // Expand the event bottom sheet to full height first.
        let handle = descendants(matching: .any)["sheet.handle"].firstMatch
        if !element.isHittable && handle.exists && handle.isHittable { handle.tap(); if !element.isHittable { handle.tap() } }
        var tries = 0
        while !element.isHittable && tries < 8 {
            let sheet = scrollViews.firstMatch
            if sheet.exists { sheet.swipeUp() } else { swipeUp() }
            tries += 1
        }
        XCTAssertTrue(element.isHittable, "\(element) not hittable", file: file, line: line)
    }
}
