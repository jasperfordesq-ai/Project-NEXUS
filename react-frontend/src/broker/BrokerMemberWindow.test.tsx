// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const modalSpy = vi.hoisted(() => vi.fn());
vi.mock('./components/MemberDetailModal', () => ({
  default: (props: { userId: number | null; onClose: () => void }) => {
    modalSpy(props.userId);
    return props.userId ? (
      <div role="dialog" aria-label={`member ${props.userId}`}>
        <button type="button" onClick={props.onClose}>close window</button>
      </div>
    ) : null;
  },
}));

import { BrokerMemberWindowProvider, MemberName, useMemberWindow } from './BrokerMemberWindow';

function Url() {
  const { search } = useLocation();
  return <output data-testid="url">{search}</output>;
}

function Opener({ id }: { id: number }) {
  const { open } = useMemberWindow();
  return <button type="button" onClick={() => open(id)}>open {id}</button>;
}

const wrap = (ui: React.ReactNode, initial = '/test/broker/exchanges?status=disputed') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <BrokerMemberWindowProvider>
        {ui}
        <Url />
      </BrokerMemberWindowProvider>
    </MemoryRouter>,
  );

describe('BrokerMemberWindowProvider', () => {
  it('opens the member window from ?member= in the address bar', () => {
    wrap(<span />, '/test/broker/members?member=42');
    expect(screen.getByRole('dialog', { name: 'member 42' })).toBeInTheDocument();
  });

  it('ignores a ?member= value that is not a positive whole number', () => {
    wrap(<span />, '/test/broker/members?member=abc');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open() adds the parameter and keeps the page filters', async () => {
    wrap(<Opener id={7} />);
    await userEvent.click(screen.getByRole('button', { name: 'open 7' }));
    expect(screen.getByRole('dialog', { name: 'member 7' })).toBeInTheDocument();
    expect(screen.getByTestId('url').textContent).toBe('?status=disputed&member=7');
  });

  it('closing removes only the member parameter', async () => {
    wrap(<span />, '/test/broker/exchanges?status=disputed&member=7');
    await userEvent.click(screen.getByRole('button', { name: 'close window' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('url').textContent).toBe('?status=disputed');
  });
});

describe('MemberName', () => {
  it('renders a link-styled button that opens the window and names the member', async () => {
    wrap(<MemberName userId={9} name="Priya Nolan" />);
    const button = screen.getByRole('button', { name: "Open Priya Nolan's record" });
    expect(button).toHaveTextContent('Priya Nolan');
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'member 9' })).toBeInTheDocument();
  });

  it('does not bubble the click to a clickable row around it', async () => {
    const rowClick = vi.fn();
    wrap(
      <div role="row" onClick={rowClick}>
        <MemberName userId={9} name="Priya Nolan" />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: "Open Priya Nolan's record" }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('falls back to plain text when there is no member id', () => {
    wrap(<MemberName userId={null} name="Deleted account" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Deleted account')).toBeInTheDocument();
  });

  it('names an unnamed member honestly', () => {
    wrap(<MemberName userId={3} name="" />);
    expect(screen.getByRole('button', { name: "Open Unknown member's record" })).toBeInTheDocument();
  });
});
