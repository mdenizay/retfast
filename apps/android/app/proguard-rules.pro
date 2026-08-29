# kotlinx.serialization keeps its generated serializers via reflection on the
# companion; without these the Supabase models fail to decode at runtime.
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisible*Annotations, EnclosingMethod
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class com.mizibu.retfast.**$$serializer { *; }
-keepclassmembers class com.mizibu.retfast.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.mizibu.retfast.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Ktor / OkHttp
-dontwarn org.slf4j.**
-dontwarn kotlinx.coroutines.**
-dontwarn io.ktor.**
-keep class io.ktor.client.engine.okhttp.** { *; }
