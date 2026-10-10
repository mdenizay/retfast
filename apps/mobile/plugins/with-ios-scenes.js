// iOS 27 SDK ile derlenen uygulamalar UIScene yaşam döngüsünü benimsemek zorundadır; aksi hâlde açılışta
// "UIScene life cycle is required" ile reddedilir. Expo, `ExpoAppSceneDelegate` sınıfını sağlıyor ama şablon
// henüz kullanmıyor. Bu eklenti:
//   1) Info.plist'e UIApplicationSceneManifest ekler,
//   2) AppDelegate'i ExpoReactNativeFactoryProvider yapar ve React Native'i sahne temsilcisine bırakır.
// Expo şablonu sahneyi kendiliğinden benimsediğinde bu eklenti kaldırılabilir.
const { withInfoPlist, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      const file = path.join(dir, 'AppDelegate.swift');
      let src = fs.readFileSync(file, 'utf8');
      if (src.includes('ExpoReactNativeFactoryProvider')) return cfg; // zaten uygulanmış

      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
      // React Native artık sahne temsilcisinde (pencere sahneden gelir) başlatılır.
      const start = /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\n?/;
      if (!start.test(src)) throw new Error('with-ios-scenes: AppDelegate.swift şablonu beklenen biçimde değil; eklentiyi güncelle.');
      src = src.replace(start, '    // React Native, ExpoAppSceneDelegate içinde sahne penceresiyle başlatılır (UIScene).\n');
      fs.writeFileSync(file, src);
      return cfg;
    },
  ]);
}

module.exports = (config) => withSceneAppDelegate(withSceneManifest(config));
