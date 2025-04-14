/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { join } from 'node:path';

import type { Browser, Page} from '@playwright/test';
import { chromium, expect as playExpect } from '@playwright/test';
import { StatusBar, TroubleshootingPage } from '@podman-desktop/tests-playwright';

export async function findPageWithTitleInBrowser(browser: Browser, expectedTitle: string): Promise<Page|undefined> {
    let chromePage: Page | undefined;
  
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pages = browser.contexts().flatMap(context => context.pages());
      const pagesTitles = await Promise.all(pages.map(async (page) => (
        { page, title: await page.title() }
      )));
  
      chromePage = pagesTitles.find(p => p.title.includes(expectedTitle))?.page;
      if (chromePage) {
        break;
      }
    }
  
    if (!chromePage) {
        console.error(`No page found with title: ${expectedTitle}`);
    }
    return chromePage;
  }
  
  export async function performBrowserLogin(page: Page, username: string, pass: string, path: string): Promise<void> {
    console.log(`Performing browser login...`);
    await playExpect(page).toHaveTitle(/Log In/);
    await playExpect(page.getByRole('heading', { name: 'Log in to your Red Hat' })).toBeVisible();
    console.log(`We are on the login RH Login page...`);
    const input = page.getByRole('textbox', { name: 'Red Hat login or email' });
    await playExpect(input).toBeVisible();
    await input.fill(username);
    const nextButton = page.getByRole('button', { name: 'Next' });
    await nextButton.click();
    const passInput = page.getByRole('textbox', { name: 'Password' });
    await playExpect(passInput).toBeVisible();
    await passInput.fill(pass);
    const loginButton = page.getByRole('button', { name: 'Log in' });
    await playExpect(loginButton).toBeEnabled();
    await loginButton.click();
    const backButton = page.getByRole('button', { name: 'Go back to Podman Desktop' });
    await playExpect(backButton).toBeEnabled();
    await page.screenshot({ path: join(path, 'screenshots', 'after_login_in_browser.png'), type: 'png', fullPage: true });
    console.log(`Logged in, go back...`);
    await backButton.click();
    await page.screenshot({ path: join(path, 'screenshots', 'after_clck_go_back.png'), type: 'png', fullPage: true });
  }
  
  export async function startChromium(port: string, tracesPath: string): Promise<Browser> {
    console.log('Starting a web server on port 9222');
    const browserLaunch = await chromium.launch({
      headless: false,
      args: [`--remote-debugging-port=${port}`],
      tracesDir: tracesPath,
      slowMo: 200,
    });
  
    // hard wait
    await new Promise(resolve => setTimeout(resolve, 5_000));
    // Connect to the same Chrome instance via CDP
    // possible option is to use chromium.connectOverCDP(`http://localhost:${port}`);
    if (!browserLaunch) {
      throw Error('Browser object was not initialized properly');
    } else {
      console.log(`Browser connected: ${browserLaunch.isConnected()}`);
    }
    return browserLaunch;
  }
  
  export async function getSSOUrlFromLogs(page: Page, regex: RegExp): Promise<string | undefined> {
    await new StatusBar(page).troubleshootingButton.click();
    const troublePage = new TroubleshootingPage(page);
    await playExpect(troublePage.heading).toBeVisible();
    // open logs
    await troublePage.openLogs();
    const logList = troublePage.tabContent.getByRole('list');
    await playExpect(logList).toBeVisible();
    const ssoLine = logList.getByRole('listitem').filter( { hasText: /\[redhat-authentication\].*openid-connect.*/ });
    await playExpect(ssoLine).toBeVisible();
    await ssoLine.scrollIntoViewIfNeeded();
    await playExpect(ssoLine).toContainText('sso.redhat.com');
    const logText = await ssoLine.innerText();
    console.log(`The whole log line with url to openid: ${logText}`);
    // parse the url:
    const parsedString = regex.exec(logText);
    const urlMatch = parsedString ? parsedString[1] : undefined;
    console.log(`Matched string: ${urlMatch}`);
    return urlMatch;
  }
  

  