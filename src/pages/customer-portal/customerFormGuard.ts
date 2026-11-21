let dirty = false

export function setCustomerPaymentFormDirty(value: boolean) {
  dirty = !!value
}

export function isCustomerPaymentFormDirty() {
  return dirty
}
