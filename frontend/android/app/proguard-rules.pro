# 인터맵 출시 빌드(R8) 규칙.
# Capacitor 플러그인 클래스와 @PluginMethod 메서드는 Capacitor가 함께 주는 규칙(consumer rules)이 지킨다.
# 여기에는 그 밖에 이름이 바뀌면 안 되는 것만 적는다.

# 웹(JS)과 네이티브를 잇는 Capacitor 본체 — 리플렉션과 JS 인터페이스로 불리므로 이름·멤버를 그대로 둔다
-keep class com.getcapacitor.** { *; }
-keep class com.intermap.app.MainActivity { *; }

# 웹뷰에 노출하는 메서드
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 오류 보고서에서 줄 번호를 볼 수 있게 (원래 파일 이름은 숨긴다). 풀어 읽는 표(mapping.txt)는 Play에 함께 올린다
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
