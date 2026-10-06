import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentAccessSettings } from './AgentAccessSettings';
import { useStore } from '../store/useStore';
import type { McpPolicy } from '../../shared/vault/mcpPolicy';

const original = window.electronAPI;
let getMcpPolicy: ReturnType<typeof vi.fn>;
let setMcpPolicy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getMcpPolicy = vi.fn().mockResolvedValue({ success: true, data: { policy: { default: 'read-only', folders: { private: 'hidden', inbox: 'read-write' } }, present: true } });
  setMcpPolicy = vi.fn(async (policy: McpPolicy) => ({ success: true, data: { policy } }));
  window.electronAPI = { ...original, getMcpPolicy, setMcpPolicy } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' }, noteFolders: [{ name: 'Work', notes: [] }] });
});
afterEach(() => { window.electronAPI = original; });

describe('AgentAccessSettings', () => {
  it('shows the vault-wide access and one line per folder rule', async () => {
    render(<AgentAccessSettings />);
    expect(await screen.findByLabelText('Everywhere else')).toHaveValue('read-only');
    expect(screen.getByTestId('agent-access').querySelectorAll('[data-rule]')).toHaveLength(2);
    expect(screen.getByLabelText('private')).toHaveValue('hidden');
    expect(screen.getByLabelText('inbox')).toHaveValue('read-write');
  });

  it('changing the default or a folder saves the whole policy', async () => {
    render(<AgentAccessSettings />);
    fireEvent.change(await screen.findByLabelText('Everywhere else'), { target: { value: 'hidden' } });
    await waitFor(() => expect(setMcpPolicy).toHaveBeenLastCalledWith({ default: 'hidden', folders: { private: 'hidden', inbox: 'read-write' } }, undefined));
    fireEvent.change(screen.getByLabelText('inbox'), { target: { value: 'read-only' } });
    await waitFor(() => expect(setMcpPolicy).toHaveBeenLastCalledWith({ default: 'hidden', folders: { private: 'hidden', inbox: 'read-only' } }, undefined));
  });

  it('adds a folder rule (its name normalized) and removes one', async () => {
    render(<AgentAccessSettings />);
    await screen.findByLabelText('Everywhere else');
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: ' /Work/Secret\\Plans/ ' } });
    fireEvent.change(screen.getByLabelText('Agent access', { selector: 'select' }), { target: { value: 'read-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(setMcpPolicy).toHaveBeenLastCalledWith({ default: 'read-only', folders: { private: 'hidden', inbox: 'read-write', 'work/secret/plans': 'read-only' } }, undefined));
    await screen.findByLabelText('work/secret/plans');
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule for private' }));
    await waitFor(() => expect(setMcpPolicy).toHaveBeenLastCalledWith(expect.objectContaining({ folders: expect.not.objectContaining({ private: expect.anything() }) }), undefined));
  });

  it('a policy file that is invalid is shown, says agents reach nothing, and can be reset', async () => {
    getMcpPolicy.mockResolvedValue({ success: true, data: { error: '.noted/mcp-policy.yaml is invalid: default must be one of hidden, read-only, read-write' } });
    render(<AgentAccessSettings />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Assistants can reach nothing until it is fixed');
    expect(screen.queryByLabelText('Everywhere else')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reset to open access' }));
    await waitFor(() => expect(setMcpPolicy).toHaveBeenCalledWith({ default: 'read-write', folders: {} }, undefined));
    expect(await screen.findByLabelText('Everywhere else')).toHaveValue('read-write');
  });

  it('says when saving failed', async () => {
    setMcpPolicy.mockResolvedValueOnce({ success: false, error: 'disk full' });
    render(<AgentAccessSettings />);
    fireEvent.change(await screen.findByLabelText('Everywhere else'), { target: { value: 'hidden' } });
    expect(await screen.findByText('Could not save the policy: disk full')).toBeInTheDocument();
  });
});
