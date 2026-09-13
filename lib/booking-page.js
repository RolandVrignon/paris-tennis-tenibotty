export const selectBookingDate = async (page, date) => {
  await page.click('#when')
  // Search results contain a second, hidden calendar with the same dates.
  await page.locator(`.date-picker [dateiso="${date}"]:visible`).click()
  await page.waitForSelector('.date-picker', { state: 'hidden' })
}

export const readPriceDescription = async locator => {
  // textContent preserves the exact tariff label despite CSS text-transform.
  const text = await locator.evaluate(element => {
    const copy = element.cloneNode(true)
    copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
    return copy.textContent
  })
  const [priceType, courtType] = text.split('\n').map(value => value.trim()).filter(Boolean)
  return { priceType, courtType }
}
