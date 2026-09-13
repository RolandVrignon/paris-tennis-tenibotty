// Select the site's payment card so its own handler enables the next step.
// This prepares checkout only: clicking the returned button confirms the booking.
export const preparePayment = async (page, { free = false } = {}) => {
  const mode = free ? 'free' : 'existingTicket'
  const card = page.locator(`.priceTable .price-item[paymentMode="${mode}"]`)
  if (await card.count() !== 1) throw new Error(free ? 'Free payment card unavailable' : 'No compatible existing credit offered at checkout; card payment is not supported')
  await card.click()
  const submit = page.locator('.step-two #submit:not(.disabled):not([disabled]):not([aria-disabled="true"])')
  await submit.waitFor({ state: 'visible' })
  if (!(await submit.isEnabled())) throw new Error('Payment next step is not enabled')
  return submit
}
