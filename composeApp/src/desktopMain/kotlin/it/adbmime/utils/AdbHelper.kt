package it.adbmime.utils

import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.*
import java.util.concurrent.TimeUnit

object AdbHelper {
    private const val ADB_PATH = "adb"

    fun getConnectedDevices(): List<String> {
        val devices = mutableListOf<String>()
        try {
            val process = ProcessBuilder(ADB_PATH, "devices").start()
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (line!!.endsWith("device")) {
                    devices.add(line!!.split("\t")[0])
                }
            }
            process.waitFor(5, TimeUnit.SECONDS)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return devices
    }

    fun runForAdbStreamResult(deviceId: String, command: String): String {
        return try {
            val cmd = listOf(ADB_PATH, "-s", deviceId, "shell", command)
            val process = ProcessBuilder(cmd).start()
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val result = reader.readLine() ?: ""
            process.waitFor(5, TimeUnit.SECONDS)
            result
        } catch (e: Exception) {
            e.printStackTrace()
            ""
        }
    }

    fun runAdbCommand(deviceId: String, vararg args: String) {
        try {
            val cmd = mutableListOf(ADB_PATH, "-s", deviceId)
            cmd.addAll(args)
            val process = ProcessBuilder(cmd).start()
            process.waitFor(5, TimeUnit.SECONDS)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
