// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { assertFetchAllowed, setConfiguredLlmHosts } from './llm-guard';

beforeEach(() => setConfiguredLlmHosts([]));

describe('llm-fetch host guard', () => {
  it.each([
    'https://api.openai.com/v1/chat/completions',
    'https://api.anthropic.com/v1/messages',
    'http://localhost:1234/v1/models',
    'http://127.0.0.1:11434/api/tags',
    'http://[::1]:8080/x',
    'http://my.service.localhost/x',
  ])('allows %s', (url) => {
    expect(() => assertFetchAllowed(url)).not.toThrow();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'https://evil.example.com/steal',
    'http://192.168.1.50:11434/api',        // LAN is blocked until the user configures it
    'http://2852039166/',                    // 169.254.169.254 written as one decimal number
    'http://0xA9FEA9FE/',                    // ... and as hex
  ])('blocks %s', (url) => {
    expect(() => assertFetchAllowed(url)).toThrow(/Blocked host/);
  });

  it('allows only http(s) and well-formed URLs', () => {
    expect(() => assertFetchAllowed('file:///etc/passwd')).toThrow('Only http(s) URLs are allowed');
    expect(() => assertFetchAllowed('ftp://api.openai.com/x')).toThrow('Only http(s) URLs are allowed');
    expect(() => assertFetchAllowed('not a url')).toThrow('Invalid URL');
  });

  it('allows a host the user configured, case-insensitively and with IPv6 brackets stripped', () => {
    setConfiguredLlmHosts(['192.168.1.50', 'LLM.Home.Lan', '[fd00::1]']);
    expect(() => assertFetchAllowed('http://192.168.1.50:11434/api')).not.toThrow();
    expect(() => assertFetchAllowed('http://llm.home.lan/v1')).not.toThrow();
    expect(() => assertFetchAllowed('http://[fd00::1]/v1')).not.toThrow();
  });

  it('never allows a cloud-metadata host, even when the renderer asks for it', () => {
    setConfiguredLlmHosts(['169.254.169.254', 'metadata.google.internal', '100.100.100.200', 'fd00:ec2::254']);
    expect(() => assertFetchAllowed('http://169.254.169.254/latest')).toThrow(/Blocked host/);
    expect(() => assertFetchAllowed('http://metadata.google.internal/x')).toThrow(/Blocked host/);
    expect(() => assertFetchAllowed('http://100.100.100.200/x')).toThrow(/Blocked host/);
  });

  it('replaces the configured list each time, ignores junk, and caps it at 32 entries', () => {
    setConfiguredLlmHosts(['one.lan']);
    setConfiguredLlmHosts('nope');
    expect(() => assertFetchAllowed('http://one.lan/')).toThrow(/Blocked host/);

    setConfiguredLlmHosts([42, '', '  ', null, 'ok.lan']);
    expect(() => assertFetchAllowed('http://ok.lan/')).not.toThrow();

    setConfiguredLlmHosts(Array.from({ length: 40 }, (_, i) => `h${i}.lan`));
    expect(() => assertFetchAllowed('http://h31.lan/')).not.toThrow();
    expect(() => assertFetchAllowed('http://h32.lan/')).toThrow(/Blocked host/);
  });
});
