import XCTest

@MainActor
final class LaunchTests: XCTestCase {
    override func setUp() async throws { continueAfterFailure = false }

    /// Launches the real app on the simulator, walks onboarding and reaches login.
    func testLaunchOnboardingToLogin() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"]
        app.launch()

        app.completeOnboarding()

        XCTAssertTrue(app.buttons["auth.apple"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["auth.google"].exists)
        app.buttons["auth.email"].tap()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.secureTextFields["login.password"].exists)
    }
}

extension XCUIApplication {
    /// Pages through onboarding until the finish button is reachable, then acknowledges and finishes.
    @MainActor func completeOnboarding(file: StaticString = #filePath, line: UInt = #line) {
        let next = buttons["onboarding.next"]
        let finish = buttons["onboarding.finish"]
        XCTAssertTrue(next.waitForExistence(timeout: 10), file: file, line: line)
        var guardCount = 0
        while !finish.exists && guardCount < 20 {
            if next.isHittable { next.tap() }
            _ = finish.waitForExistence(timeout: 1)
            guardCount += 1
        }
        XCTAssertTrue(finish.exists, file: file, line: line)
        XCTAssertFalse(finish.isEnabled, "Must acknowledge emergency limitations first", file: file, line: line)
        let ack = switches["onboarding.ack"]
        XCTAssertTrue(ack.waitForExistence(timeout: 5), file: file, line: line)
        let inner = ack.switches.firstMatch
        (inner.exists ? inner : ack).tap()
        XCTAssertTrue(finish.isEnabled, file: file, line: line)
        finish.tap()
    }
}
