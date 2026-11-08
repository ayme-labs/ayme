import { ayme } from "@ayme-dev/ayme";

@ayme
export class SearchBox {}

@ayme
export class ResultsPage {}

@ayme
export class SearchPage {
  @ayme.child
  searchBox!: SearchBox;

  @ayme.action
  async search(): Promise<ResultsPage> {
    return new ResultsPage();
  }
}

@ayme
export class SettingsPage {}
