const digits = value => String(value || '').replace(/\D/g, '');

export function validCpfCnpj(raw) {
  const value = digits(raw);
  if (![11, 14].includes(value.length) || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    const check = base => {
      let sum = 0;
      for (let i = 0; i < base; i++) sum += Number(value[i]) * (base + 1 - i);
      const digit = (sum * 10) % 11;
      return Number(value[base]) === (digit === 10 ? 0 : digit);
    };
    return check(9) && check(10);
  }
  const calc = count => {
    let weight = count - 7, sum = 0;
    for (let i = 0; i < count; i++) {
      sum += Number(value[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return Number(value[12]) === calc(12) && Number(value[13]) === calc(13);
}
