import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

function readPort(rawValue: string | undefined, fallback: number, name: string) {
  const port = rawValue ? Number(rawValue) : fallback
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const mdevWebPort = process.env.MDEV_WEB_PORT || env.MDEV_WEB_PORT
  const mdevApiPort = process.env.MDEV_API_PORT || env.MDEV_API_PORT
  const dataSource = process.env.VITE_DATA_SOURCE || env.VITE_DATA_SOURCE || 'production'
  if (dataSource !== 'production' && dataSource !== 'local') {
    throw new Error('VITE_DATA_SOURCE must be either "production" or "local"')
  }

  const webPort = readPort(mdevWebPort, 5173, 'MDEV_WEB_PORT')
  const apiPort = readPort(mdevApiPort, 8787, 'MDEV_API_PORT')
  const proxyTarget =
    process.env.VITE_PROXY_TARGET ||
    env.VITE_PROXY_TARGET ||
    (dataSource === 'local' ? `http://127.0.0.1:${apiPort}` : 'https://www.tommma.ru')
  const stripApiPrefix = dataSource === 'local' && !process.env.VITE_PROXY_TARGET && !env.VITE_PROXY_TARGET

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => (stripApiPrefix ? path.replace(/^\/api/, '') : path),
        },
      },
    },
  }
})
