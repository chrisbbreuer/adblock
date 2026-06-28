import packageJson from '../package.json'

const archive = `adblock-${packageJson.version}.zip`

await Bun.$`rm -f ${archive}`
await Bun.$`cd dist && zip -qr ../${archive} .`

console.log(`Created ${archive}`)
