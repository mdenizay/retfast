import Foundation

/// GPX 1.1 export of locally stored samples. Raw Core Location values only.
/// This is NOT a certified flight log (not IGC, no security record).
public enum GPXExporter {
    public static func gpx(flightName: String, samples: [TelemetrySample], isSimulated: Bool) -> String {
        var out = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Retfast iOS" xmlns="http://www.topografix.com/GPX/1/1">
          <metadata>
            <name>\(escape(flightName))</name>
            <desc>\(escape("Retfast GPS track. Not a certified flight log." + (isSimulated ? " SIMULATED DATA." : "")))</desc>
          </metadata>
          <trk>
            <name>\(escape(flightName))</name>
            <trkseg>

        """
        for s in samples.sorted(by: { $0.seq < $1.seq }) {
            out += "      <trkpt lat=\"\(fmt(s.lat, 7))\" lon=\"\(fmt(s.lon, 7))\">"
            if let alt = s.altitude { out += "<ele>\(fmt(alt, 1))</ele>" }
            out += "<time>\(JSONCoding.formatDate(s.t))</time>"
            out += "</trkpt>\n"
        }
        out += """
            </trkseg>
          </trk>
        </gpx>

        """
        return out
    }

    static func fmt(_ v: Double, _ digits: Int) -> String {
        String(format: "%.\(digits)f", locale: Locale(identifier: "en_US_POSIX"), v)
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}
