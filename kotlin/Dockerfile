# --- DEV STAGE ---
FROM docker.io/eclipse-temurin:21-jdk AS dev
WORKDIR /workspace
ENV GRADLE_USER_HOME=/gradle

# --- BUILD STAGE ---
FROM docker.io/eclipse-temurin:21-jdk AS build
ARG SERVICE
WORKDIR /workspace

# Copy the shared gradle files to the image
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
COPY services/${SERVICE} services/${SERVICE}
RUN --mount=type=cache,target=/gradle ./gradlew -g /gradle :services:${SERVICE}:bootJar

# --- RUN STAGE ---
FROM docker.io/eclipse-temurin:21-jre
ARG SERVICE

# Create a non root user to run the service
RUN groupadd --system --gid 10001 service  
RUN useradd --system --uid 10001 --gid service --no-create-home service
COPY --from=build /workspace/services/${SERVICE}/build/libs/service.jar /service.jar

# Run as non root user 
USER 10001
ENTRYPOINT ["java", "-jar", "/service.jar"]

