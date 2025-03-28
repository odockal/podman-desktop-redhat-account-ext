/**********************************************************************
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { NavigationBar, StatusBar } from '@podman-desktop/tests-playwright';
import { AuthenticationPage, expect as playExpect, ExtensionCardPage, RunnerOptions, test } from '@podman-desktop/tests-playwright';

import { SSOExtensionPage } from './model/pages/sso-extension-page'
import { ChildProcess, exec, execSync } from 'child_process';
import { Browser, chromium, Page } from '@playwright/test';
import { SSOAuthenticationProviderCardPage } from './model/pages/sso-authentication-page';
import { TroubleshootingPage } from './model/pages/troubleshooting-page';

let extensionInstalled = false;
let extensionCard: ExtensionCardPage;
let ssoProvider: SSOAuthenticationProviderCardPage;
let authPage: AuthenticationPage;
const chromePort = '9222';
let chromeProcess: ChildProcess;
const imageName = 'ghcr.io/redhat-developer/podman-desktop-redhat-account-ext:latest';
const extensionLabel = 'redhat.redhat-authentication';
const extensionLabelName = 'redhat-authentication';
const podmanExtensionLabel = 'podman-desktop.podman';
const podmanExtensionLabelName = 'podman';
const authProviderName = 'Red Hat SSO';
const activeExtensionStatus = 'ACTIVE';
const disabledExtensionStatus = 'DISABLED';
const expectedAuthPageTitle = 'Log In';
const skipInstallation = process.env.SKIP_INSTALLATION ? process.env.SKIP_INSTALLATION : false;

test.use({ 
  runnerOptions: new RunnerOptions({ customFolder: 'sso-tests-pd', autoUpdate: false, autoCheckUpdates: false }),
});
test.beforeAll(async ({ runner, page, welcomePage }) => {
  runner.setVideoAndTraceName('sso-e2e');
  await welcomePage.handleWelcomePage(true);
  extensionCard = new ExtensionCardPage(page, extensionLabelName, extensionLabel);
  authPage = new AuthenticationPage(page);
  ssoProvider = new SSOAuthenticationProviderCardPage(page);
});

test.afterAll(async ({ runner }) => {
  // At the end of the test, close Chrome using its PID
  if (chromeProcess && chromeProcess.pid) {
    console.log(`Terminating Chrome process (PID: ${chromeProcess.pid})`);
    try {
     process.kill(chromeProcess.pid);
    } catch (error) {
      if ((error as Error).message.includes('ESRCH')) {
        console.log(`Error occured when killing ${chromeProcess.pid}, probably already killed: ${error}`);
      } else {
        throw error;
      }
    }
  }
  await runner.close();
});

test.describe.serial('Red Hat Authentication extension verification', () => {
  test.describe.serial('Red Hat Authentication extension installation', () => {
    // PR check builds extension locally and so it is available already
    test('Go to extensions and check if extension is already installed', async ({ navigationBar }) => {
      const result = execSync('echo "Where am I?: $(pwd)"');
      console.log(`ExeSync output: ${result.toString()}`);
      const extensions = await navigationBar.openExtensions();
      if (await extensions.extensionIsInstalled(extensionLabel)) {
        extensionInstalled = true;
      }
    });

    // // we want to skip removing of the extension when we are running tests from PR check
    // test('Uninstall previous version of sso extension', async ({ navigationBar }) => {
    //   test.skip(!extensionInstalled || !!skipInstallation);
    //   test.setTimeout(60000);
    //   await removeExtension(navigationBar);
    // });

    test('Podman Extension is activated', async ({ navigationBar }) => {
      const extensions = await navigationBar.openExtensions();
      const podmanExtensionCard = await extensions.getInstalledExtension(podmanExtensionLabelName, podmanExtensionLabel);
      await podmanExtensionCard.card.scrollIntoViewIfNeeded();
      await playExpect(podmanExtensionCard.status).toHaveText(activeExtensionStatus, { timeout: 20_000 });
    });

    // we want to install extension from OCI image (usually using latest tag) after new code was added to the codebase
    // and extension was published already
    test('Extension can be installed using OCI image', async ({ navigationBar }) => {
      test.skip(extensionInstalled);
      test.setTimeout(200000);
      const extensions = await navigationBar.openExtensions();
      await extensions.installExtensionFromOCIImage(imageName);
      await extensionCard.card.scrollIntoViewIfNeeded();
      await playExpect(extensionCard.card).toBeVisible({ timeout: 15_000 });
    });

    test('Extension (card) is installed, present and active', async ({ navigationBar }) => {
      const extensions = await navigationBar.openExtensions();
      await playExpect.poll(async () => 
        await extensions.extensionIsInstalled(extensionLabel), { timeout: 30000 },
      ).toBeTruthy();
      const extensionCard = await extensions.getInstalledExtension(extensionLabelName, extensionLabel);
      await playExpect(extensionCard.status).toHaveText(activeExtensionStatus);
    });

    test('Extension\'s details show correct status, no error', async ({ page,navigationBar }) => {
      const extensions = await navigationBar.openExtensions();
      const extensionCard = await extensions.getInstalledExtension(extensionLabelName, extensionLabel);
      await extensionCard.openExtensionDetails('Red Hat Authentication');
      const details = new SSOExtensionPage(page);
      await playExpect(details.heading).toBeVisible();
      await playExpect(details.status).toHaveText(activeExtensionStatus);
      const errorTab = details.tabs.getByRole('button', { name: 'Error' });
      // we would like to propagate the error's stack trace into test failure message
      let stackTrace = '';
      if ((await errorTab.count()) > 0) {
        await details.activateTab('Error');
        stackTrace = await details.errorStackTrace.innerText();
      }
      await playExpect(errorTab, `Error Tab was present with stackTrace: ${stackTrace}`).not.toBeVisible();
    });

    test('SSO provider is available in Authentication Page', async ({ navigationBar }) => {
      const settingsBar = await navigationBar.openSettings();
      await settingsBar.openTabPage(AuthenticationPage);
      await playExpect(authPage.heading).toHaveText('Authentication');
      await playExpect(ssoProvider.parent).toBeVisible();
      await playExpect(ssoProvider.providerName).toHaveText(authProviderName);
      await playExpect(ssoProvider.signinButton).toBeVisible();
      await ssoProvider.checkUserIsLoggedIn(false);
    });
  });

  test.describe.serial('Red Hat Authentication extension handling', () => {
    test.skip();
    test('Extension can be disabled', async ({ navigationBar }) => {
      const extensions = await navigationBar.openExtensions();
      playExpect(await extensions.extensionIsInstalled(extensionLabel)).toBeTruthy();
      const extensionCard = await extensions.getInstalledExtension(extensionLabelName, extensionLabel);
      await playExpect(extensionCard.status).toHaveText(activeExtensionStatus);
      await extensionCard.disableExtension();
      await playExpect(extensionCard.status).toHaveText(disabledExtensionStatus);

      const settingsBar = await navigationBar.openSettings();
      await settingsBar.openTabPage(AuthenticationPage);
      await playExpect(authPage.heading).toHaveText('Authentication');
      await playExpect(ssoProvider.parent).not.toBeVisible();
    });

    test('Extension can be re-enabled correctly', async ({ navigationBar }) => {
      const extensions = await navigationBar.openExtensions();
      playExpect(await extensions.extensionIsInstalled(extensionLabel)).toBeTruthy();
      const extensionCard = await extensions.getInstalledExtension(extensionLabelName, extensionLabel);
      await playExpect(extensionCard.status).toHaveText(disabledExtensionStatus);
      await extensionCard.enableExtension();
      await playExpect(extensionCard.status).toHaveText(activeExtensionStatus);

      const settingsBar = await navigationBar.openSettings();
      await settingsBar.openTabPage(AuthenticationPage);
      await playExpect(authPage.heading).toHaveText('Authentication');
      await playExpect(ssoProvider.parent).toBeVisible();
    }); 
  });

  test.describe.serial('Can authenticate via browser', () => {
    test('Open Authentication Page', async ({ navigationBar, page }) => {
      test.setTimeout(60000);
      const settingsBar = await navigationBar.openSettings();
      await settingsBar.openTabPage(AuthenticationPage);
      await playExpect(ssoProvider.parent).toBeVisible();

      // start up chrome instance and return browser object
      const browser = await startChrome(chromePort, page);

      // open the link from PD
      await ssoProvider.signIn();
      await page.waitForTimeout(3000);

      // get to a default page -> the sso
      let chromePage = await findRightPageInBrowser(browser, expectedAuthPageTitle);
      if (!chromePage) {
        throw new Error('Did not find Initial SSO Login Page');
      }

      // Step 7: Perform login actions on the right page
      await chromePage.bringToFront();
      console.log(`Switched to Chrome tab with title: ${await chromePage.title()}`);
      await performBrowserLogin(chromePage, process.env.DVLPR_USERNAME ?? 'unknown', process.env.DVLPR_PASSWORD ?? 'unknown');
      await chromePage.close();

      // Close the browser
      await browser.close();

      // At the end of the test, close Chrome using its PID
      if (chromeProcess && chromeProcess.pid) {
        console.log(`Terminating Chrome process (PID: ${chromeProcess.pid})`);
        process.kill(chromeProcess.pid);
      }

      // activate Podman Desktop again
      await page.bringToFront();

      // on linux we need to avoid issue with auth. providers store
      // in case of need, refresh auth. providers store in troubleshooting
      const status = new StatusBar(page);
      await status.troubleshootingButton.click();
      const troubleshooting = new TroubleshootingPage(page);
      await troubleshooting.refreshStore('auth provders');
      
      // verify the Signed in user
      await navigationBar.openSettings();
      await settingsBar.openTabPage(AuthenticationPage);
      await playExpect(authPage.heading).toHaveText('Authentication');
      await ssoProvider.checkUserIsLoggedIn(true);
      await playExpect(ssoProvider.signinButton).not.toBeVisible();
      await playExpect(ssoProvider.providerStatus).toHaveText('Logged in');

      // TODO continue with the tests
    });
  });

  test('SSO extension can be removed', async ({ navigationBar }) => {
    await removeExtension(navigationBar);
  });
});

async function removeExtension(navBar: NavigationBar): Promise<void> {
  const extensions = await navBar.openExtensions();
  const extensionCard = await extensions.getInstalledExtension(extensionLabelName, extensionLabel);
  await extensionCard.disableExtension();
  await extensionCard.removeExtension();
  await playExpect.poll(async () => await extensions.extensionIsInstalled(extensionLabel), { timeout: 15000 }).toBeFalsy();
}

export async function findRightPageInBrowser(browser: Browser, expectedTitle: string): Promise<Page|undefined> {
  let chromePage;
      
  for (let context of browser.contexts()) {
    console.log(`Pages of context: ${await Promise.all(context.pages().map(async item => await item.title()))}`);
  }

  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    let allPages = browser.contexts().flatMap(context => context.pages());
    chromePage = await Promise.all(allPages.map(async (page) => ({
        page,
        title: await page.title()
    })));

    console.log(`Actual Page title: ${chromePage}`);

    chromePage = chromePage.find(p => p.title.includes(expectedTitle))?.page;
    if (chromePage) break;
  }

  if (!chromePage) {
      console.error(`No page found with title: ${expectedTitle}`);
  }
  return chromePage;
}

export async function performBrowserLogin(page: Page, username: string, pass: string): Promise<void> {
  await playExpect(page).toHaveTitle(/Log In/);
  await playExpect(page.getByRole('heading', { name: 'Log in to your Red Hat' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Red Hat login or email' });
  await playExpect(input).toBeVisible();
  await input.fill(username);
  const nextButton = page.getByRole('button', { name: 'Next' });
  await nextButton.click();
  const passInput = page.getByRole('textbox', { name: 'Password' });
  await playExpect(passInput).toBeVisible();
  passInput.fill(pass);
  const loginButton = page.getByRole('button', { name: 'Log in' });
  await playExpect(loginButton).toBeEnabled();
  await loginButton.click();
  console.log(`New Page Heading: ${await page.getByRole('heading').allInnerTexts()}`);
  const backButton = page.getByRole('button', { name: 'Go back to Podman Desktop' });
  await playExpect(backButton).toBeEnabled();
  await backButton.click();
}

export async function startChrome(port: string, page: Page): Promise<Browser> {
  // start chrome from test
  console.log(`Running the google chrome command: google-chrome --remote-debugging-port=${port}`);
  chromeProcess = exec(`google-chrome --remote-debugging-port=${port}`, (error) => {
    if (error) {
        console.error(`Error launching Chrome: ${error}`);
        return;
    }
    console.log(`Chrome launched on port ${port}.`);
  });

  // hard wait
  await new Promise(resolve => setTimeout(resolve, 20_000));
  // Connect to the same Chrome instance via CDP
  const browser = await chromium.connectOverCDP(`http://localhost:9222`);
  if (!browser) {
    throw Error('Browser object was not initialized properly');
  } else {
    console.log(`Browser connected: ${browser.isConnected()}`);
  }
  return browser;
}
