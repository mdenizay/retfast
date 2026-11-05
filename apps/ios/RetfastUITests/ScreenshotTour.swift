import XCTest

/// Captures each main screen (stub API) as PNGs into $TOUR_DIR. Skipped unless set.
final class ScreenshotTour: XCTestCase {
    @MainActor func testTour() throws {
        let dir = ProcessInfo.processInfo.environment["TOUR_DIR"] ?? ""
        try XCTSkipIf(dir.isEmpty, "TOUR_DIR not set")
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-stubAPI", "-stubLocation"]
        app.launch()
        app.login(email: "pilot@stub.local", password: "anything-long")
        func shot(_ name: String) {
            Thread.sleep(forTimeInterval: 1.5)
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
        shot("tour_events")
        let tabs = app.tabBars.buttons
        for i in 0..<tabs.count {
            tabs.element(boundBy: i).tap()
            shot("tour_tab\(i)")
        }
        let flightsTab = tabs.element(boundBy: 1)
        if flightsTab.exists {
            flightsTab.tap()
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'flights.row.'")).firstMatch.tap()
            shot("tour_flight")
            app.swipeUp(); shot("tour_flight_stats")
            app.swipeDown()
            if app.buttons["flight.replay"].waitForExistence(timeout: 5) {
                app.buttons["flight.replay"].tap()
                app.buttons["replay.play"].tap()
                Thread.sleep(forTimeInterval: 4)
                shot("tour_replay")
                app.buttons["replay.close"].tap()
            }
            if app.navigationBars.buttons.firstMatch.exists { app.navigationBars.buttons.firstMatch.tap() }
        }
        tabs.element(boundBy: 0).tap()
        if let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'events.row.'")).allElementsBoundByIndex.first {
            row.tap(); shot("tour_event")
            let wx = app.descendants(matching: .any)["event.weather"].firstMatch
            _ = wx.waitForExistence(timeout: 10)
            app.swipeUp(); shot("tour_weather")
        }
    }
}
