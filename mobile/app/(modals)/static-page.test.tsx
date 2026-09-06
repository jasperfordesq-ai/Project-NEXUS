// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiResponseError } from '@/lib/api/client';
import { getStaticPageContent, submitContactMessage } from '@/lib/api/staticPages';
import { useAppToast } from '@/components/ui/AppToast';
import StaticPageRoute from './static-page';

let mockSearchParams: Record<string, string> = {};
let mockTenant: { slug: string; contact?: Record<string, string> | null } = { slug: 'hour-timebank' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api/staticPages', () => ({
  ...jest.requireActual('@/lib/api/staticPages'),
  getStaticPageContent: jest.fn(),
  submitContactMessage: jest.fn(),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#0ea5e9',
  useTenant: () => ({ tenant: mockTenant }),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text testID="top-bar-title">{title}</Text>;
  };
});

const mockGetPage = getStaticPageContent as jest.MockedFunction<typeof getStaticPageContent>;
const mockSubmit = submitContactMessage as jest.MockedFunction<typeof submitContactMessage>;
const showToast = useAppToast().show as jest.Mock;

const ABOUT_PAGE = {
  route_key: 'about',
  page_key: 'about',
  path: '/about',
  title: 'About Hour Timebank',
  lead: 'Every hour of service is valued equally.',
  tenant: { id: 2, slug: 'hour-timebank', name: 'Hour Timebank' },
  sections: [
    {
      key: 'how_it_works',
      title: 'How it works',
      body: 'Four steps to join.',
      items: [
        { title: 'Create your profile', description: 'List the skills you can offer.' },
        { title: 'Earn and spend credits', description: 'One hour given is one hour earned.' },
      ],
    },
  ],
};

const CONTACT_PAGE = {
  route_key: 'contact',
  page_key: 'contact',
  path: '/contact',
  title: 'Contact Us',
  lead: 'We would love to hear from you.',
  tenant: { id: 2, slug: 'hour-timebank', name: 'Hour Timebank' },
  sections: [
    {
      key: 'contact_form',
      title: 'Contact form',
      body: '',
      items: [
        { key: 'general', description: 'General Inquiry' },
        { key: 'account', description: 'Account Help' },
      ],
    },
  ],
};

async function renderPage() {
  const view = render(<StaticPageRoute />);
  await waitFor(() => expect(view.queryByTestId('top-bar-title')).toBeTruthy());
  return view;
}

async function fillAndSubmit(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('Your name'), 'Aoife Ryan');
  fireEvent.changeText(view.getByLabelText('Your email address'), 'aoife@example.org');
  fireEvent.changeText(view.getByLabelText('Message'), 'Can you help me find a gardener?');
  await act(async () => {
    fireEvent.press(view.getByLabelText('Send message'));
  });
}

describe('StaticPageRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { key: 'about' };
    mockTenant = { slug: 'hour-timebank' };
    mockGetPage.mockResolvedValue(ABOUT_PAGE);
    mockSubmit.mockResolvedValue({ data: { message: 'Sent' } });
  });

  /*
    🔴 The whole reason this screen exists. The support screen used to show a
    hand-written three-section summary built from `support.docs.<key>.section1Title`
    and offer "Open on the website" for the real text. Everything asserted below
    comes from the server's own response.
  */
  it('renders the community\'s real page content, from the server', async () => {
    const { getAllByText, getByText, getByTestId } = await renderPage();

    // Twice on purpose: once in the top bar, once as the page heading.
    await waitFor(() => expect(getAllByText('About Hour Timebank')).toHaveLength(2));
    expect(getByTestId('top-bar-title')).toHaveTextContent('About Hour Timebank');
    expect(mockGetPage).toHaveBeenCalledWith('about');
    expect(getByText('Every hour of service is valued equally.')).toBeTruthy();
    expect(getByText('How it works')).toBeTruthy();
    expect(getByText('Create your profile')).toBeTruthy();
    expect(getByText('One hour given is one hour earned.')).toBeTruthy();
  });

  /*
    🔴 `trust-safety` is the page KEY; `/trust-and-safety` is the web PATH. Asking
    the endpoint for the path returns RESOURCE_NOT_FOUND, so the support screen
    must send the key — verified against the local API on 2026-09-06.
  */
  it('asks for trust and safety by its page key, not by its web path', async () => {
    mockSearchParams = { key: 'trust-safety' };
    mockGetPage.mockResolvedValue({ ...ABOUT_PAGE, page_key: 'trust-safety', title: 'Trust and safety' });

    await renderPage();

    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith('trust-safety'));
  });

  it('refuses a page key the server does not serve, without calling the API', async () => {
    mockSearchParams = { key: 'terms' };

    const { getByTestId } = await renderPage();

    expect(getByTestId('static-page-unknown')).toBeTruthy();
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('offers a retry that re-asks the server after a failure', async () => {
    mockGetPage.mockRejectedValueOnce(new ApiResponseError(403, 'Not available.'));

    const { getByTestId, getByText } = await renderPage();

    await waitFor(() => expect(getByTestId('static-page-error')).toBeTruthy());

    mockGetPage.mockResolvedValue(ABOUT_PAGE);
    await act(async () => {
      fireEvent.press(getByText('Retry'));
    });

    await waitFor(() => expect(getByText('Every hour of service is valued equally.')).toBeTruthy());
    expect(mockGetPage).toHaveBeenCalledTimes(2);
  });

  it('says so when the community has published nothing on the page', async () => {
    mockGetPage.mockResolvedValue(null);

    const { getByTestId } = await renderPage();

    await waitFor(() => expect(getByTestId('static-page-empty')).toBeTruthy());
  });

  describe('contact', () => {
    beforeEach(() => {
      mockSearchParams = { key: 'contact' };
      mockGetPage.mockResolvedValue(CONTACT_PAGE);
    });

    it('shows the form only on the contact page', async () => {
      mockSearchParams = { key: 'about' };
      mockGetPage.mockResolvedValue(ABOUT_PAGE);

      const { queryByTestId } = await renderPage();

      await waitFor(() => expect(queryByTestId('static-page-error')).toBeNull());
      expect(queryByTestId('contact-form')).toBeNull();
    });

    it('sends the message with the subject the member chose', async () => {
      const view = await renderPage();
      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());

      // The subject chips are the only place the server's subject list is shown:
      // rendering the contact_form section as prose too would duplicate every one.
      fireEvent.press(view.getByText('Account Help'));
      await fillAndSubmit(view);

      expect(mockSubmit).toHaveBeenCalledWith({
        name: 'Aoife Ryan',
        email: 'aoife@example.org',
        // The human-readable label, exactly as the website posts it.
        subject: 'Account Help',
        message: 'Can you help me find a gardener?',
      });
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
      expect(view.getByTestId('contact-form-sent')).toBeTruthy();
    });

    it('defaults to the first subject the server offered', async () => {
      const view = await renderPage();
      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());

      await fillAndSubmit(view);

      expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ subject: 'General Inquiry' }));
    });

    it('refuses to send an incomplete message, and says which field is wrong', async () => {
      const view = await renderPage();
      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());

      fireEvent.changeText(view.getByLabelText('Your email address'), 'not-an-address');
      await act(async () => {
        fireEvent.press(view.getByLabelText('Send message'));
      });

      expect(mockSubmit).not.toHaveBeenCalled();
      expect(view.getByText('Enter your name.')).toBeTruthy();
      expect(view.getByText('Enter a valid email address.')).toBeTruthy();
      expect(view.getByText('Write a message before sending.')).toBeTruthy();
    });

    /*
      🔴 `POST /v2/contact` is the one endpoint that enforces Cloudflare Turnstile,
      and a native app cannot render that widget. It fails open while
      TURNSTILE_SECRET_KEY is unset, which is how production is configured today —
      so if it is ever set, the member must be told what to do instead of being
      shown a generic failure. Matched on the CODE: the message is translated.
    */
    it('points the member at the community\'s own contact details when the bot check refuses', async () => {
      mockTenant = { slug: 'hour-timebank', contact: { email: 'hello@hour-timebank.ie' } };
      mockSubmit.mockRejectedValue(new ApiResponseError(422, 'Verification failed.', undefined, 'TURNSTILE_FAILED'));

      const view = await renderPage();
      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());
      await fillAndSubmit(view);

      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Message not sent',
        description: expect.stringContaining('browser security check'),
        variant: 'danger',
      }));
      expect(view.queryByTestId('contact-form-sent')).toBeNull();
      // …and the address it points at is actually on screen.
      expect(view.getByText('hello@hour-timebank.ie')).toBeTruthy();
    });

    it('shows the server\'s own explanation for an ordinary failure', async () => {
      // A 4xx: `describeApiError` deliberately suppresses 5xx messages, which are
      // internal failure descriptions rather than instructions to a member.
      mockSubmit.mockRejectedValue(new ApiResponseError(400, 'A valid email address is required.'));

      const view = await renderPage();
      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());
      await fillAndSubmit(view);

      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
        description: 'A valid email address is required.',
        variant: 'danger',
      }));
    });

    it('shows the community\'s contact details when it has published any', async () => {
      mockTenant = {
        slug: 'hour-timebank',
        contact: { email: 'hello@hour-timebank.ie', phone: '+353 1 555 0100' },
      };

      const view = await renderPage();

      await waitFor(() => expect(view.getByTestId('contact-details')).toBeTruthy());
      expect(view.getByText('hello@hour-timebank.ie')).toBeTruthy();
      expect(view.getByText('+353 1 555 0100')).toBeTruthy();
      expect(view.queryByText('Postal address')).toBeNull();
    });

    it('omits the contact-details card entirely when the community has published none', async () => {
      const view = await renderPage();

      await waitFor(() => expect(view.getByTestId('contact-form')).toBeTruthy());
      expect(view.queryByTestId('contact-details')).toBeNull();
    });
  });
});
