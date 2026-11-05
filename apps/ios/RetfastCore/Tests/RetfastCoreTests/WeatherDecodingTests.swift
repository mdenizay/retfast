import XCTest
@testable import RetfastCore

final class WeatherDecodingTests: XCTestCase {
    func testDecodesAPIPayload() throws {
        let json = """
        {"source":"open-meteo","attribution":"Weather data by Open-Meteo.com (CC BY 4.0)","lat":37.7,"lon":29.13,"elevation_m":917,
         "fetched_at":"2026-11-05T18:03:12.123456Z",
         "current":{"t":"2026-11-05T18:00:00Z","temp_c":8.3,"wind_ms":1.7,"wind_dir_deg":3,"gust_ms":8.2,"cloud_cover_pct":46,"precip_mm":0},
         "hourly":[{"t":"2026-11-05T18:00:00Z","temp_c":8.3,"dew_point_c":4.1,"wind_ms":1.7,"wind_dir_deg":3,"gust_ms":8.2,
           "wind_850_ms":4.56,"wind_850_dir_deg":34,"cape_jkg":0,"precip_prob_pct":0,"cloud_cover_pct":46,"cloud_base_m":1440,
           "flyability":"poor","fly_reasons":["gusty"]}],
         "flyability":"poor","fly_reasons":["gusty"]}
        """
        let w = try JSONCoding.makeDecoder().decode(Weather.self, from: Data(json.utf8))
        XCTAssertEqual(w.flyability, "poor")
        XCTAssertEqual(w.hourly.first?.wind850Ms, 4.56)
        XCTAssertEqual(w.hourly.first?.cloudBaseM, 1440)
        XCTAssertEqual(w.flyReasons, ["gusty"])
        XCTAssertNotNil(w.fetchedAt)
    }
}
