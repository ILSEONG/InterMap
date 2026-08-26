# 1단계: Gradle로 bootJar 빌드
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew --no-daemon bootJar

# 2단계: JRE만 담은 실행 이미지
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
# H2 파일 DB는 볼륨 마운트 지점(/data)에 둔다
ENV JDBC_URL=jdbc:h2:file:/data/intermap
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
