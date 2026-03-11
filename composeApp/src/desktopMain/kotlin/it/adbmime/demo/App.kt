package it.adbmime.demo

import javafx.application.Application
import javafx.fxml.FXMLLoader
import javafx.scene.Parent
import javafx.scene.Scene
import javafx.scene.image.Image
import javafx.stage.Stage
import java.io.IOException

class App : Application() {

    override fun start(stage: Stage) {
        scene = Scene(loadFXML("adbmime"), 1280.0, 800.0)
        scene.stylesheets.add(App::class.java.getResource("/css/default-theme.css")?.toExternalForm())
        stage.scene = scene
        stage.title = "Adbmime"
        stage.icons.add(Image(App::class.java.getResourceAsStream("/application/linux/adbmime.png")))
        stage.show()
    }

    companion object {
        lateinit var scene: Scene

        @Throws(IOException::class)
        fun setRoot(fxml: String) {
            scene.root = loadFXML(fxml)
        }

        @Throws(IOException::class)
        private fun loadFXML(fxml: String): Parent {
            val fxmlLoader = FXMLLoader(App::class.java.getResource("$fxml.fxml"))
            return fxmlLoader.load()
        }
    }
}
