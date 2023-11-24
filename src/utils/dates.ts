export class Dates {
  static getDateOnly(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  static getYearAndMonthDateOnly(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0')].join('-');
  }
}
