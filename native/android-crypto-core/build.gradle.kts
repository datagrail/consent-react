import org.gradle.api.file.SourceDirectorySet

plugins {
    kotlin("jvm") version "1.9.25"
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(17)
}

// Compile ONLY the React-free crypto core (and its test) straight out of the shipped `android/`
// library sources — sharing the files rather than copying them so the code CI validates is
// byte-for-byte the code that runs on device. The rest of the library (the React-coupled bridge
// classes) is deliberately excluded, which is what lets this project build with nothing but the
// Kotlin stdlib + JUnit.
val cryptoCore = "com/datagrail/consent/rn/DataGrailConsentCryptoCore.kt"
val cryptoCoreTest = "com/datagrail/consent/rn/DataGrailConsentCryptoCoreTest.kt"

sourceSets {
    named("main") {
        val kotlinSrc = extensions.getByName("kotlin") as SourceDirectorySet
        kotlinSrc.setSrcDirs(listOf("../../android/src/main/kotlin"))
        kotlinSrc.include(cryptoCore)
    }
    named("test") {
        val kotlinSrc = extensions.getByName("kotlin") as SourceDirectorySet
        kotlinSrc.setSrcDirs(listOf("../../android/src/test/kotlin"))
        kotlinSrc.include(cryptoCoreTest)
    }
}

tasks.test {
    useJUnit()
    testLogging {
        events("passed", "failed", "skipped")
    }
}
