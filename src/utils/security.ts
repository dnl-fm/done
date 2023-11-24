import generateUniqueId from 'generate-unique-id';
import { ulid } from 'ulid';

export class Security {
  static generateId() {
    return generateUniqueId({ length: 26 }); // same length as ulid
  }

  static generateSortableId() {
    return ulid();
  }

  static generateAuthToken() {
    return generateUniqueId({ length: 128 });
  }

  static generateNumberCode(min = 10000, max = 999999) {
    return (Math.random() * (max - min) + min).toString().split('.')[0];
  }
}
