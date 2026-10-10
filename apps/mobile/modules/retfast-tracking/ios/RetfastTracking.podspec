Pod::Spec.new do |s|
  s.name           = 'RetfastTracking'
  s.version        = '1.0.0'
  s.summary        = 'Retfast native background location tracking'
  s.description    = 'CoreLocation tracking with adaptive profiles, a durable SQLite buffer and batched, idempotent sync.'
  s.author         = 'Retfast'
  s.homepage       = 'https://retfast.com'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
