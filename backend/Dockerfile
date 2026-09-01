# 1단계: Gradle로 bootJar 빌드
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY . .
# Windows에서 커밋되면 gradlew에 실행 권한이 없으므로 sh로 실행
RUN sh ./gradlew --no-daemon bootJar

# 2단계: JRE만 담은 실행 이미지
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
# DB 접속(JDBC_URL)은 Render 환경변수로 주입된다 (Neon Postgres)
EXPOSE 8080
# Render 무료 512MB. 기본 힙(1/4=128MB)은 백필 중 OOM, 75%는 힙+메타스페이스+스레드가 컨테이너 한도를 넘어
# OOM-kill 됐다. 힙 50% + SerialGC(오버헤드 최소)로 컨테이너 안에 머물게 한다.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=50", "-XX:+UseSerialGC", "-jar", "app.jar"]
