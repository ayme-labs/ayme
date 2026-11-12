import type { Page, Locator } from '@playwright/test';
export abstract class AppPage { constructor(readonly page: Page) {} }
export abstract class AppComponent { constructor(readonly root: Locator) {} }
export class Breadcrumbs extends AppComponent {
  async openRepository() { await this.root.getByRole('link', {name:'ayme',exact:true}).click(); const repo = new RepositoryPage(this.root.page()); await repo.code.waitFor(); return repo; }
}
export class RepositoryPage extends AppPage {
  readonly code = this.page.getByRole('button',{name:'Code',exact:true});
  async openPulls() { await this.page.getByRole('navigation',{name:'Repository',exact:true}).getByRole('link',{name:/^Pull requests/}).click(); const next=new PullsPage(this.page); await next.page.waitForURL('**/pulls'); return next; }
  async openReleases() { await this.page.getByRole('link',{name:'Releases',exact:true}).click(); const next=new ReleasesPage(this.page); await next.results.waitFor(); return next; }
  async openCode() { const menu=new CloneMenu(this.page.locator('div.tmp-m-3').filter({has:this.page.getByRole('list',{name:'Remote URL selector'})})); if(!await menu.root.isVisible()) await this.code.click(); await menu.root.waitFor(); return menu; }
}
export class PullRow extends AppComponent { readonly title=this.root.getByTestId('listitem-title-link'); }
export class PullsPage extends AppPage {
 readonly breadcrumbs=new Breadcrumbs(this.page.getByRole('navigation',{name:'Breadcrumbs'}));
 readonly titles=this.page.getByTestId('listitem-title-link');
 async pulls() { return (await this.page.getByRole('listitem').filter({has:this.titles}).all()).map(root=>new PullRow(root)); }
}
export class ReleasesPage extends AppPage {
 readonly breadcrumbs=new Breadcrumbs(this.page.getByRole('navigation',{name:'Breadcrumbs'}));
 readonly results=this.page.getByRole('region',{name:'Releases results'});
 release(name:string) { return this.results.getByRole('link',{name,exact:true}); }
}
export class CloneMenu extends AppComponent {
 readonly https=this.root.getByRole('textbox',{name:'Clone with HTTPS url',exact:true});
 readonly cli=this.root.getByRole('button',{name:'Clone with GitHub CLI',exact:true});
 readonly command=this.root.getByRole('textbox',{name:'Clone with GitHub CLI command',exact:true});
}
