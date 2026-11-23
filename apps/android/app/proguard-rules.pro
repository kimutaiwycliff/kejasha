# kotlinx.serialization: keep generated serializers of API models.
-keepclassmembers class ke.kejasha.api.** { *** Companion; *** serializer(...); }
-keep,includedescriptorclasses class ke.kejasha.api.**$$serializer { *; }
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
# Retrofit service interfaces are used reflectively.
-keep interface ke.kejasha.api.endpoints.** { *; }
