import { isSelectQuery } from '@/db/query';

describe('isSelectQuery', () => {
  it('accepts a basic SELECT', () => {
    expect(isSelectQuery('SELECT * FROM users')).toBe(true);
  });

  it('accepts SELECT with leading whitespace', () => {
    expect(isSelectQuery('   SELECT id FROM users')).toBe(true);
  });

  it('accepts lowercase select', () => {
    expect(isSelectQuery('select * from users')).toBe(true);
  });

  it('accepts SELECT after a line comment', () => {
    expect(isSelectQuery('-- get users\nSELECT * FROM users')).toBe(true);
  });

  it('accepts SELECT after a block comment', () => {
    expect(isSelectQuery('/* analytics */ SELECT * FROM users')).toBe(true);
  });

  it('rejects INSERT', () => {
    expect(isSelectQuery('INSERT INTO users VALUES (1)')).toBe(false);
  });

  it('rejects UPDATE', () => {
    expect(isSelectQuery('UPDATE users SET name = $1')).toBe(false);
  });

  it('rejects DELETE', () => {
    expect(isSelectQuery('DELETE FROM users')).toBe(false);
  });

  it('rejects DROP', () => {
    expect(isSelectQuery('DROP TABLE users')).toBe(false);
  });

  it('rejects TRUNCATE', () => {
    expect(isSelectQuery('TRUNCATE users')).toBe(false);
  });

  it('rejects a non-SELECT statement that contains SELECT', () => {
    expect(isSelectQuery('INSERT INTO t SELECT * FROM users')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSelectQuery('')).toBe(false);
  });
});
