const { pathToFileURL } = require("node:url")
const { tmpdir } = require("node:os")
const playwrightPath = process.env.PLAYWRIGHT_MODULE
const chromiumPath = process.env.CHROMIUM_PACKAGE
if (!playwrightPath || !chromiumPath)
  throw new Error(
    "Set PLAYWRIGHT_MODULE and CHROMIUM_PACKAGE to the external verification-tool package directories",
  )
const { chromium: playwright } = require(playwrightPath)
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")
;(async () => {
  const { default: chromium } = await import(
    pathToFileURL(path.join(chromiumPath, "build/index.js")).href
  )
  const { inflate } = await import(pathToFileURL(path.join(chromiumPath, "build/lambdafs.js")).href)
  await inflate(path.join(chromiumPath, "bin/al2023.tar.br"))
  process.env.LD_LIBRARY_PATH = path.join(tmpdir(), "al2023/lib")
  const executable = await chromium.executablePath()
  const launch = () =>
    playwright.launch({
      executablePath: executable,
      args: chromium.args.filter(
        (arg) =>
          ![
            "--allow-running-insecure-content",
            "--disable-web-security",
            "--disable-site-isolation-trials",
          ].includes(arg),
      ),
      headless: true,
    })
  const output = __dirname
  fs.mkdirSync(output, { recursive: true })
  const evidence = []
  let browser = null
  try {
    for (const width of [360, 800, 1280]) {
      for (const theme of ["light", "dark"]) {
        browser = await launch()
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
          reducedMotion: "reduce",
        })
        const page = await context.newPage()
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text())
        })
        await page.goto("http://127.0.0.1:4173/")
        await page.evaluate(() => document.fonts.ready)
        assert.equal(await page.locator("#page-title").textContent(), "Credential storage")
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
        assert.equal(overflow, false, `${width}/${theme} horizontal overflow`)
        await page.locator("#save").click()
        assert.equal(await page.evaluate(() => document.activeElement.id), "cancel")
        await page.keyboard.press("Shift+Tab")
        assert.equal(await page.evaluate(() => document.activeElement.id), "allow")
        await page.keyboard.press("Tab")
        assert.equal(await page.evaluate(() => document.activeElement.id), "cancel")
        await page.keyboard.press("Escape")
        assert.equal(await page.evaluate(() => document.activeElement.id), "save")
        assert.equal(await page.locator("#voice-state").textContent(), "Not saved")
        await page.locator("#save").click()
        await page.locator("#allow").click()
        assert.equal(await page.locator("#voice-state").textContent(), "Stored without encryption")
        await page.locator("#scenario").selectOption("ready")
        assert.equal(await page.locator("#voice-state").textContent(), "Stored without encryption")
        await page.locator("#consent").click()
        await page.locator("#scenario").selectOption("blocked")
        assert.equal(
          await page.locator("#policy").textContent(),
          "Not saved without your permission",
        )
        await page.locator("#reset").click()
        await page.locator("#scenario").selectOption("save-failed")
        await page.locator("#save").click()
        await page.locator("#allow").click()
        assert.equal(await page.locator("#consent-error").isVisible(), true)
        assert.equal(await page.locator("#permission").textContent(), "Not granted")
        await page.locator("#cancel").click()
        await page.locator("#reset").click()
        const screenshot = `dedicated-${width}-${theme}.png`
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true })
        await page.locator("#consent").click()
        if (width === 1280 || width === 360)
          await page.screenshot({
            path: path.join(output, `consent-${width}-${theme}.png`),
            fullPage: true,
          })
        await page.locator("#cancel").click()
        await page.locator('[data-layout="models"]').click()
        assert.equal(await page.locator("#page-title").textContent(), "Models")
        if (width === 1280)
          await page.screenshot({
            path: path.join(output, `models-${width}-${theme}.png`),
            fullPage: true,
          })
        evidence.push({
          width,
          theme,
          screenshot,
          overflow,
          errors,
          checks: [
            "default-approved-direction",
            "cancel-focus",
            "tab-trap",
            "escape-restoration",
            "cancel-no-save",
            "consent-then-save",
            "recovery-keeps-plaintext-label",
            "revocation",
            "failed-consent-no-grant",
            "option-switch",
          ],
        })
        assert.deepEqual(errors, [])
        await context.close()
        if (browser) await browser.close()
        browser = null
      }
    }
  } finally {
    fs.writeFileSync(path.join(output, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`)
    if (browser) await browser.close()
  }
  console.log(JSON.stringify(evidence, null, 2))
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
