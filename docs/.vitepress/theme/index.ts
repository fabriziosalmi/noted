import DefaultTheme from 'vitepress/theme'
import './style.css'

// Noted docs use the VitePress default theme with a light, variable-only skin
// (see style.css). No layout classes are overridden, so the theme upgrades
// cleanly with VitePress.
export default {
  extends: DefaultTheme,
}
