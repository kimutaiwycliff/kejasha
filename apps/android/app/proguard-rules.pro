# kotlinx.serialization: keep generated serializers of API models and the app's own
# @Serializable classes (navigation routes, the cached account).
-keepclassmembers class ke.kejasha.** { *** Companion; *** serializer(...); }
-keep,includedescriptorclasses class ke.kejasha.**$$serializer { *; }
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions, RuntimeVisibleAnnotations
# Enum query values are read from @SerialName on the enum fields (EnumQueryConverterFactory).
-keepclassmembers enum ke.kejasha.api.** { <fields>; }
# Retrofit service interfaces are used reflectively.
-keep interface ke.kejasha.api.endpoints.** { *; }
# The sync worker is created by WorkManager by class name.
-keep class ke.kejasha.app.data.sync.SyncWorker { <init>(...); }
