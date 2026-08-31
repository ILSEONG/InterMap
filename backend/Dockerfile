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
ENTRYPOINT ["java", "-jar", "app.jar"]
