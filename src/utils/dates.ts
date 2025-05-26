/**
 * Utility class for date formatting operations.
 */
export class Dates {
  /**
   * Formats a date into YYYY-MM-DD format.
   * @param {Date} date - The date to format.
   * @returns {string} The formatted date string in YYYY-MM-DD format.
   */
  static getDateOnly(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  /**
   * Formats a date into YYYY-MM format.
   * @param {Date} date - The date to format.
   * @returns {string} The formatted date string in YYYY-MM format.
   */
  static getYearAndMonthDateOnly(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0')].join('-');
  }
}
