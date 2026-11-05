# kotlinx.serialization: keep generated serializers and companions of @Serializable classes
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisibleAnnotations
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.mizibu.retfast.**$$serializer { *; }
-keepclassmembers class com.mizibu.retfast.** {
    *** Companion;
}
-keepclasseswithmembers class com.mizibu.retfast.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Room: generated code is referenced reflectively by name
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# MapLibre Native (JNI + reflection on style/geometry classes)
-keep class org.maplibre.android.** { *; }
-keep class org.maplibre.geojson.** { *; }
-keep class org.maplibre.turf.** { *; }
-dontwarn org.maplibre.**

# OkHttp / Okio optional platform classes
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# WorkManager workers are instantiated reflectively by class name
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

# Play services location is consumer-ruled; keep nothing extra.
