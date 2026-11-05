import RetfastCore
import SwiftUI
import UIKit

/// SOS: everything a pilot needs in an emergency on one screen — call 112,
/// call or text the emergency contact with the coordinates, share the
/// position, and the coordinates in large type to read out on the phone.
/// Retfast does not alert anyone by itself; the screen says so.
struct EmergencySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var locator = OneShotLocator()
    @State private var copied = false

    private var position: SharedPosition? {
        if let p = model.recentFix(maxAge: 60) { return p }
        if let f = locator.fix {
            return SharedPosition(lat: f.latitude, lon: f.longitude, gpsAltM: f.verticalAccuracy > 0 ? f.altitude : nil,
                                  hAccM: f.horizontalAccuracy, t: f.timestamp)
        }
        return nil
    }

    private var contactName: String? { model.me?.pilot?.emergencyContactName.flatMap { $0.isEmpty ? nil : $0 } }
    private var contactPhone: String? { model.me?.pilot?.emergencyContactPhone.flatMap { $0.isEmpty ? nil : $0 } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                    HStack(spacing: AeroTokens.Space.s3) {
                        Image(icon: "siren")
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(AeroTokens.onEmergency)
                            .frame(width: 56, height: 56)
                            .background(AeroTokens.emergency, in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Acil durum").font(.title2.bold()).foregroundStyle(AeroTokens.textPrimary)
                            Text("Önce 112'yi ara, konumunu oku.").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                        }
                    }

                    coordinates

                    Button { call("112") } label: { Label("112'yi ara", icon: "phone.fill") }
                        .buttonStyle(PrimaryButtonStyle(kind: .destructive, large: true))
                        .accessibilityIdentifier("sos.call112")

                    if let phone = contactPhone {
                        Button { call(phone) } label: {
                            Label(String(localized: "\(contactName ?? String(localized: "Acil kişi"))'i ara"), icon: "phone.fill")
                        }
                        .buttonStyle(.aeroInk)
                        Button { sms(phone) } label: { Label("Konumu SMS ile gönder", icon: "text.bubble") }
                            .buttonStyle(.aeroSecondary)
                            .disabled(position == nil)
                    } else {
                        WarningRow(text: String(localized: "Acil durum kişisi eklenmemiş. Profil › Pilot bilgileri'nden ekleyebilirsin."), tone: .info, systemImage: "info.circle")
                    }

                    if let text = shareText {
                        ShareLink(item: text) { Label("Konumu paylaş", icon: "square.and.arrow.up") }
                            .buttonStyle(.aeroSecondary)
                    }

                    Text("Retfast bir acil durum servisi değildir ve kimseye otomatik haber vermez. Mümkünse etkinlik organizatörünü de ara.")
                        .font(.footnote).foregroundStyle(AeroTokens.textSecondary)
                }
                .padding(AeroTokens.Space.s4)
            }
            .aeroBackground()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Kapat") { dismiss() } } }
        }
        .presentationDetents([.large])
        .onAppear { if model.recentFix(maxAge: 60) == nil { locator.request() } }
        .onDisappear { locator.stop() }
    }

    @ViewBuilder private var coordinates: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
            Text("Konumun").font(.caption.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
            if let p = position {
                Text(Fmt.coordinate(p.lat, p.lon))
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .foregroundStyle(AeroTokens.textPrimary)
                    .minimumScaleFactor(0.6).lineLimit(2)
                    .textSelection(.enabled)
                HStack {
                    if let alt = p.gpsAltM {
                        let a = Fmt.altitude(alt)
                        Text("İrtifa \(a.0) \(a.1)")
                    }
                    Text("± \(Fmt.accuracy(p.hAccM))")
                    Spacer()
                    Button(copied ? "Kopyalandı" : "Kopyala") {
                        UIPasteboard.general.string = String(format: "%.6f, %.6f", p.lat, p.lon)
                        copied = true
                        Haptics.success()
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            } else {
                Label(locator.failed ? "Konum alınamadı" : "Konum alınıyor…", icon: "location.magnifyingglass")
                    .foregroundStyle(AeroTokens.textSecondary)
            }
        }
        .padding(AeroTokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
    }

    private var shareText: String? {
        guard let p = position else { return nil }
        let name = model.me?.fullName ?? "Retfast"
        return String(localized: "ACİL: \(name) yardım istiyor. Konum: \(String(format: "%.6f, %.6f", p.lat, p.lon)) https://maps.apple.com/?ll=\(String(format: "%.6f,%.6f", p.lat, p.lon))&q=SOS")
    }

    private func call(_ number: String) {
        if let url = AppleMaps.telURL(number) { openURL(url) }
    }

    private func sms(_ number: String) {
        let digits = number.filter { $0.isNumber || $0 == "+" }
        var comps = URLComponents()
        comps.scheme = "sms"
        comps.path = digits
        comps.queryItems = [URLQueryItem(name: "body", value: shareText ?? "")]
        if let url = comps.url { openURL(url) }
    }
}
