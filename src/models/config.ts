export class SzuruSiteConfig {
  id = window.crypto.randomUUID();
  domain = "https://example.com";
  username = "user";
  authToken = "";
}

export class TagCategoryColor {
  constructor(
    public name: string,
    public color: string,
  ) {}
}

export const getDefaultTagCategories = () => [
  new TagCategoryColor("copyright", "#a0a"),
  new TagCategoryColor("character", "#0a0"),
  new TagCategoryColor("artist", "#a00"),
  new TagCategoryColor("meta", "#f80"),
];
