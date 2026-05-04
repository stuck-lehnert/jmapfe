import { registerRootComponent } from "expo"
import App from "./src/App"
import { AppStorage } from "./src/backend"
import { Theme } from "./src/theme"

Theme.applyAppearanceMode(AppStorage.loadAppearanceMode())

registerRootComponent(App)
