import Otp from '@/models/otp';
import {
  Browser,
  DAY_MS,
  HOUR_MS,
  KNOWN_BROWSER_SECONDS,
  MINUTE_MS,
  codesSentTo,
  controlClock,
  knownBrowser,
  newAddress,
  newBrowsers,
  newEmail,
  receiveCode,
  repeated,
  requestAtOnce,
  requestCode,
  requestInTurn,
  restoreDelivery,
  sentCount,
  signIn,
} from './signInBrowsers';

// The send-limit cases of tests/helpers/signInContract.ts, which provides their setup.

async function fillEmail(email: string, count = 50) {
  const browsers = newBrowsers(count);
  expect(await requestAtOnce(count, (i) => requestCode(browsers[i], email))).toEqual(repeated(count, 200));
}

async function fillSite(count = 220) {
  const browsers = newBrowsers(count);
  expect(await requestAtOnce(count, (i) => requestCode(browsers[i], newEmail()))).toEqual(repeated(count, 200));
}

async function fillAddress(address: string, count = 40) {
  const browser = new Browser(address);
  expect(await requestAtOnce(count, () => requestCode(browser, newEmail()))).toEqual(repeated(count, 200));
}

const requestFromNewBrowser = (email = newEmail()) => requestCode(new Browser(), email);

function silenceErrors() {
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

function failDelivery() {
  silenceErrors();
  jest.mocked(global.fetch).mockImplementation(async () => new Response('{}', { status: 500 }));
}

function describeAddressAndEmailLimit() {
  describe('per client address and email, for a browser that is not known', () => {
    it('sends three codes, then refuses without replacing the last', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, email);
      await receiveCode(browser, email);
      const code = await receiveCode(browser, email);

      const res = await requestCode(browser, email);

      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('Too many codes requested. Please try again later.');
      expect(codesSentTo(email)).toHaveLength(3);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('allows three in any 15 minutes', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, email);
      moveTo(14 * MINUTE_MS);
      await receiveCode(browser, email);
      await receiveCode(browser, email);

      moveTo(15 * MINUTE_MS - 1);
      expect((await requestCode(browser, email)).status).toBe(429);

      moveTo(15 * MINUTE_MS);
      expect(await requestInTurn(2, () => requestCode(browser, email))).toEqual([200, 429]);
    });

    it('allows ten in any 24 hours, refusals not counted', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      for (let round = 0; round < 3; round++) {
        moveTo(round * HOUR_MS);
        expect(await requestInTurn(6, () => requestCode(browser, email))).toEqual([
          ...repeated(3, 200),
          ...repeated(3, 429),
        ]);
      }

      moveTo(3 * HOUR_MS);
      expect(await requestInTurn(2, () => requestCode(browser, email))).toEqual([200, 429]);

      moveTo(DAY_MS - 1);
      expect((await requestCode(browser, email)).status).toBe(429);

      moveTo(DAY_MS);
      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('counts browsers at one address together', async () => {
      const [address, email] = [newAddress(), newEmail()];
      for (let i = 0; i < 3; i++) await receiveCode(new Browser(address), email);

      expect((await requestCode(new Browser(address), email)).status).toBe(429);
    });

    it('leaves other addresses their own allowance', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      for (let i = 0; i < 3; i++) await receiveCode(browser, email);

      expect((await requestFromNewBrowser(email)).status).toBe(200);
    });

    it('leaves other emails their own allowance', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      for (let i = 0; i < 3; i++) await receiveCode(browser, email);

      expect((await requestCode(browser, newEmail())).status).toBe(200);
    });

    it('counts an email once whatever its letter case', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      for (let i = 0; i < 3; i++) await receiveCode(browser, email);

      expect((await requestCode(browser, email.toUpperCase())).status).toBe(429);
    });

    it('keeps the limit after a sign-in from another browser at that address', async () => {
      const [address, email] = [newAddress(), newEmail()];
      for (let i = 0; i < 3; i++) {
        const browser = new Browser(address);
        await signIn(browser, email, await receiveCode(browser, email));
      }

      expect((await requestCode(new Browser(address), email)).status).toBe(429);
    });

    it('sends three codes when twelve requests race', async () => {
      const [browser, email] = [new Browser(), newEmail()];

      expect(await requestAtOnce(12, () => requestCode(browser, email))).toEqual([
        ...repeated(3, 200),
        ...repeated(9, 429),
      ]);
      expect(sentCount()).toBe(3);
    });

    it('sends only the last of the ten when requests race for it', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      for (let round = 0; round < 3; round++) {
        moveTo(round * HOUR_MS);
        for (let i = 0; i < 3; i++) await receiveCode(browser, email);
      }

      moveTo(3 * HOUR_MS);
      expect(await requestAtOnce(6, () => requestCode(browser, email))).toEqual([200, ...repeated(5, 429)]);
    });
  });
}

function describeKnownBrowserLimit() {
  describe('per known browser and email', () => {
    it('sends five codes, then refuses without replacing the last', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      let code = '';
      for (let i = 0; i < 5; i++) code = await receiveCode(browser, email);

      expect((await requestCode(browser, email)).status).toBe(429);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('allows five in any 15 minutes', async () => {
      const moveTo = controlClock();
      const email = newEmail();
      const browser = await knownBrowser(email);
      await receiveCode(browser, email);
      moveTo(14 * MINUTE_MS);
      for (let i = 0; i < 4; i++) await receiveCode(browser, email);

      moveTo(15 * MINUTE_MS - 1);
      expect((await requestCode(browser, email)).status).toBe(429);

      moveTo(15 * MINUTE_MS);
      expect(await requestInTurn(2, () => requestCode(browser, email))).toEqual([200, 429]);
    });

    it('allows twenty in any 24 hours, refusals not counted', async () => {
      const moveTo = controlClock();
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let round = 0; round < 4; round++) {
        moveTo(round * HOUR_MS);
        expect(await requestInTurn(7, () => requestCode(browser, email))).toEqual([
          ...repeated(5, 200),
          429,
          429,
        ]);
      }

      moveTo(4 * HOUR_MS);
      expect((await requestCode(browser, email)).status).toBe(429);

      moveTo(DAY_MS - 1);
      expect((await requestCode(browser, email)).status).toBe(429);

      moveTo(DAY_MS);
      expect(await requestInTurn(6, () => requestCode(browser, email))).toEqual([...repeated(5, 200), 429]);
    });

    it('follows the browser to another address', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) {
        browser.address = newAddress();
        await receiveCode(browser, email);
      }

      browser.address = newAddress();
      expect((await requestCode(browser, email)).status).toBe(429);
    });

    it('gives each known browser its own allowance', async () => {
      const email = newEmail();
      const [first, second] = [await knownBrowser(email), await knownBrowser(email)];
      second.address = first.address;
      for (let i = 0; i < 5; i++) await receiveCode(first, email);

      expect((await requestCode(second, email)).status).toBe(200);
    });

    it('is not used up by other browsers at the same address', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 3; i++) await receiveCode(new Browser(browser.address), email);
      expect((await requestCode(new Browser(browser.address), email)).status).toBe(429);

      expect(await requestInTurn(5, () => requestCode(browser, email))).toEqual(repeated(5, 200));
    });

    it('gives a browser known for another email the ordinary allowance', async () => {
      const browser = await knownBrowser(newEmail());
      const email = newEmail();

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('does not renew with each sign-in', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) {
        const code = await receiveCode(browser, email);
        // Without this cookie at sign-in, the browser must still get the same device back.
        browser.jar.delete(browser.cookieLasting(KNOWN_BROWSER_SECONDS)!.name);
        await signIn(browser, email, code);
      }

      expect((await requestCode(browser, email)).status).toBe(429);
    });

    it('sends five codes when twelve requests race', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);

      expect(await requestAtOnce(12, () => requestCode(browser, email))).toEqual([
        ...repeated(5, 200),
        ...repeated(7, 429),
      ]);
    });

    it('is still served when the per-email limit is full', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      await fillEmail(email, 49);
      expect((await requestFromNewBrowser(email)).status).toBe(429);

      expect((await signIn(browser, email, await receiveCode(browser, email))).status).toBe(200);
    });

    it('is still served when the site-wide limit is full', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      await fillSite(219);
      expect((await requestFromNewBrowser()).status).toBe(429);

      expect((await signIn(browser, email, await receiveCode(browser, email))).status).toBe(200);
    });

    it('takes nothing from the per-email limit', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) await receiveCode(browser, email);

      await fillEmail(email, 49);
    });

    it('takes nothing from the site-wide limit', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) await receiveCode(browser, email);

      await fillSite(219);
    });
  });
}

function describePerEmailLimit() {
  describe('per email, for browsers that are not known', () => {
    it('sends fifty, then refuses', async () => {
      const email = newEmail();
      await fillEmail(email);

      expect((await requestFromNewBrowser(email)).status).toBe(429);
      expect((await requestFromNewBrowser()).status).toBe(200);
    });

    it('allows fifty in any 24 hours', async () => {
      const moveTo = controlClock();
      const email = newEmail();
      await fillEmail(email, 1);
      moveTo(HOUR_MS);
      await fillEmail(email, 49);

      moveTo(DAY_MS - 1);
      expect((await requestFromNewBrowser(email)).status).toBe(429);

      moveTo(DAY_MS);
      expect(await requestInTurn(2, () => requestFromNewBrowser(email))).toEqual([200, 429]);
    });

    it('counts an email once whatever its letter case', async () => {
      const email = newEmail();
      await fillEmail(email);

      expect((await requestFromNewBrowser(email.toUpperCase())).status).toBe(429);
    });

    it('sends fifty when sixty requests race', async () => {
      const email = newEmail();

      expect(await requestAtOnce(60, () => requestFromNewBrowser(email))).toEqual([
        ...repeated(50, 200),
        ...repeated(10, 429),
      ]);
    });
  });
}

function describeSiteWideLimit() {
  describe('site-wide, for browsers that are not known', () => {
    it('sends 220, then refuses', async () => {
      await fillSite();

      expect((await requestFromNewBrowser()).status).toBe(429);
      expect(sentCount()).toBe(220);
    });

    it('allows 220 in any 24 hours', async () => {
      const moveTo = controlClock();
      await fillSite(1);
      moveTo(HOUR_MS);
      await fillSite(219);

      moveTo(DAY_MS - 1);
      expect((await requestFromNewBrowser()).status).toBe(429);

      moveTo(DAY_MS);
      expect(await requestInTurn(2, () => requestFromNewBrowser())).toEqual([200, 429]);
    });

    it('sends 220 when 230 requests race, and logs that once', async () => {
      const warn = jest.mocked(console.warn);

      expect(await requestAtOnce(230, () => requestFromNewBrowser())).toEqual([
        ...repeated(220, 200),
        ...repeated(10, 429),
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('logs once per window, without addresses', async () => {
      const moveTo = controlClock();
      const warn = jest.mocked(console.warn);
      await fillSite();
      expect(warn).not.toHaveBeenCalled();

      const [browser, email] = [new Browser(), newEmail()];
      await requestInTurn(3, () => requestCode(browser, email));
      moveTo(DAY_MS - 1);
      await requestCode(browser, email);

      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toMatch(/site-wide/i);
      expect(logged).not.toContain('@');
      expect(logged).not.toContain(browser.address);

      moveTo(DAY_MS);
      await fillSite();
      await requestCode(browser, email);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
}

function describePerAddressLimit() {
  describe('per client address, for everyone', () => {
    it('sends forty, then refuses', async () => {
      const address = newAddress();
      await fillAddress(address);

      expect((await requestCode(new Browser(address), newEmail())).status).toBe(429);
      expect((await requestFromNewBrowser()).status).toBe(200);
    });

    it('allows forty in any 24 hours', async () => {
      const moveTo = controlClock();
      const address = newAddress();
      await fillAddress(address, 1);
      moveTo(HOUR_MS);
      await fillAddress(address, 39);

      moveTo(DAY_MS - 1);
      expect((await requestCode(new Browser(address), newEmail())).status).toBe(429);

      moveTo(DAY_MS);
      const statuses = await requestInTurn(2, () => requestCode(new Browser(address), newEmail()));
      expect(statuses).toEqual([200, 429]);
    });

    it('applies to known browsers', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      await fillAddress(browser.address!);

      expect((await requestCode(browser, email)).status).toBe(429);
    });

    it('counts what known browsers send', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) await receiveCode(browser, email);
      await fillAddress(browser.address!, 35);

      expect((await requestCode(new Browser(browser.address), newEmail())).status).toBe(429);
    });

    it('sends forty when fifty requests race', async () => {
      const browser = new Browser();

      expect(await requestAtOnce(50, () => requestCode(browser, newEmail()))).toEqual([
        ...repeated(40, 200),
        ...repeated(10, 429),
      ]);
    });
  });
}

function describeClientAddresses() {
  describe('client addresses', () => {
    it.each([
      ['one IPv6 /64', '2001:db8:1:2::1', '2001:DB8:1:2:ffff:ffff:ffff:ffff'],
      ['a compressed and a full IPv6 prefix', '2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0009'],
      ['an IPv6 address with and without a zone', 'fe80::1%eth0', 'fe80::2'],
      ['IPv4-mapped and IPv4', '::ffff:198.51.100.7', '198.51.100.7'],
      ['IPv4-mapped in hex and IPv4', '::FFFF:c633:6407', '198.51.100.7'],
      ['IPv4-mapped in full and IPv4', '0:0:0:0:0:ffff:198.51.100.7', '198.51.100.7'],
    ])('counts %s as one', async (_kind, first, second) => {
      const email = newEmail();
      for (let i = 0; i < 3; i++) await receiveCode(new Browser(first), email);

      expect((await requestCode(new Browser(second), email)).status).toBe(429);
    });

    it.each([
      ['neighbouring IPv6 /64s', '2001:db8:1:2::1', '2001:db8:1:3::1'],
      ['two IPv4 addresses', '198.51.100.7', '198.51.100.8'],
      ['two IPv4-mapped addresses', '::ffff:198.51.100.7', '::ffff:198.51.100.8'],
      ['IPv6 loopback and IPv4', '::1', '0.0.0.1'],
    ])('counts %s apart', async (_kind, first, second) => {
      const email = newEmail();
      for (let i = 0; i < 3; i++) await receiveCode(new Browser(first), email);

      expect((await requestCode(new Browser(second), email)).status).toBe(200);
    });

    it('counts the forty per address by /64', async () => {
      await fillAddress('2001:db8:5:6::1');

      expect((await requestCode(new Browser('2001:db8:5:6::2'), newEmail())).status).toBe(429);
    });

    describe.each([
      ['no header is configured', () => delete process.env.CLIENT_IP_HEADER, () => newAddress()],
      ['the header is missing', () => {}, () => null],
      ['the header holds a list', () => {}, () => `${newAddress()}, ${newAddress()}`],
      ['the header holds no address', () => {}, () => 'unknown'],
    ])('when %s', (_kind, configure, address) => {
      beforeEach(() => {
        configure();
      });

      it('skips the per-address limit', async () => {
        const browser = new Browser(address());

        expect(await requestInTurn(41, () => requestCode(browser, newEmail()))).toEqual(repeated(41, 200));
      });

      it('counts the address-and-email limit by email alone', async () => {
        const email = newEmail();

        const statuses = await requestInTurn(4, () => requestCode(new Browser(address()), email));

        expect(statuses).toEqual([200, 200, 200, 429]);
      });

      it('still gives a known browser its own allowance', async () => {
        const email = newEmail();
        const browser = await knownBrowser(email);
        browser.address = address();
        await requestInTurn(4, () => requestCode(new Browser(address()), email));

        expect(await requestInTurn(6, () => requestCode(browser, email))).toEqual([...repeated(5, 200), 429]);
      });
    });
  });
}

function describeUnusedAllowances() {
  describe('a refused request consumes nothing', () => {
    it('refused per address and email, it leaves the address its forty', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      for (let i = 0; i < 3; i++) await receiveCode(browser, email);
      expect(await requestInTurn(10, () => requestCode(browser, email))).toEqual(repeated(10, 429));

      await fillAddress(browser.address!, 37);
    });

    it('refused per known browser, it leaves the address its forty', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      for (let i = 0; i < 5; i++) await receiveCode(browser, email);
      expect(await requestInTurn(10, () => requestCode(browser, email))).toEqual(repeated(10, 429));

      await fillAddress(browser.address!, 35);
    });

    it('refused per address, it leaves the email and that pair their allowance', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      await fillAddress(browser.address!);
      moveTo(DAY_MS - 5 * MINUTE_MS);
      expect(await requestInTurn(55, () => requestCode(browser, email))).toEqual(repeated(55, 429));

      moveTo(DAY_MS);
      expect(await requestInTurn(3, () => requestCode(browser, email))).toEqual(repeated(3, 200));
      await fillEmail(email, 47);
    });

    it('refused per address, it leaves a known browser its allowance', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      await fillAddress(browser.address!);
      expect(await requestInTurn(25, () => requestCode(browser, email))).toEqual(repeated(25, 429));

      browser.address = newAddress();
      expect(await requestInTurn(5, () => requestCode(browser, email))).toEqual(repeated(5, 200));
    });

    it('refused per email, it leaves the address its forty', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      await fillEmail(email);
      expect(await requestInTurn(45, () => requestCode(browser, email))).toEqual(repeated(45, 429));

      await fillAddress(browser.address!);
    });

    it('refused site-wide, it leaves the address and the email their allowance', async () => {
      const moveTo = controlClock();
      const [address, email] = [newAddress(), newEmail()];
      await fillSite();
      moveTo(DAY_MS - 5 * MINUTE_MS);
      const refused = await requestInTurn(55, () => requestFromNewBrowser(email));
      const refusedAtAddress = await requestInTurn(45, () => requestCode(new Browser(address), newEmail()));
      expect([...refused, ...refusedAtAddress]).toEqual(repeated(100, 429));

      moveTo(DAY_MS);
      await fillEmail(email);
      await fillAddress(address);
    });

    it('refused site-wide, it replaces no code', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      await fillSite(219);

      expect((await requestCode(browser, email)).status).toBe(429);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });
  });

  describe('a failed send gives its allowance back', () => {
    it('to the pair and the address', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      failDelivery();
      expect(await requestInTurn(45, () => requestCode(browser, email))).toEqual(repeated(45, 500));

      restoreDelivery();
      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
      await fillAddress(browser.address!, 37);
    });

    it('to the email and the site', async () => {
      const email = newEmail();
      failDelivery();
      expect(await requestInTurn(230, () => requestFromNewBrowser(email))).toEqual(repeated(230, 500));

      restoreDelivery();
      await fillEmail(email);
      await fillSite(170);
    });

    it('to a known browser', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      failDelivery();
      expect(await requestInTurn(25, () => requestCode(browser, email))).toEqual(repeated(25, 500));

      restoreDelivery();
      expect(await requestInTurn(6, () => requestCode(browser, email))).toEqual([...repeated(5, 200), 429]);
    });

    it('when the email service cannot be reached', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      silenceErrors();
      jest.mocked(global.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
      expect((await requestCode(browser, email)).status).toBe(500);

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('when the code cannot be stored', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      silenceErrors();
      jest.spyOn(Otp, 'findOneAndUpdate').mockRejectedValueOnce(new Error('write failed'));
      expect((await requestCode(browser, email)).status).toBe(500);

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('and not that of a send made in the same millisecond', async () => {
      controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, email);
      failDelivery();
      expect((await requestCode(browser, email)).status).toBe(500);

      restoreDelivery();
      expect(await requestInTurn(3, () => requestCode(browser, email))).toEqual([200, 200, 429]);
    });
  });
}

export function describeSendLimits() {
  describe('send limits', () => {
    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describeAddressAndEmailLimit();
    describeKnownBrowserLimit();
    describePerEmailLimit();
    describeSiteWideLimit();
    describePerAddressLimit();
    describeClientAddresses();
    describeUnusedAllowances();
  });
}
