/**
 * Feed documents for the `/api/rss` suites (doc 19 §1: recorded shapes,
 * trimmed).
 *
 * **Synthetic text in real shapes.** Each document copies the structure of a
 * feed measured on 2026-09-24 — VnExpress's CDATA descriptions with an image
 * link and `</br>`, GitHub's Atom with escaped HTML content, Tuổi Trẻ's
 * relative redirect — but every title and sentence is written here. A trimmed
 * real feed is someone else's journalism, and this repository is GPL.
 */

/** VnExpress's shape: RSS 2.0, CDATA descriptions, `+0700` dates, a guid that
 *  is the article URL, a channel `<image>` with a title of its own. Items are
 *  deliberately out of date order. */
export const RSS_NEWS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tin mới nhất - Báo Thử Nghiệm</title>
    <description>Báo Thử Nghiệm RSS</description>
    <image>
      <url>https://img.example.vn/logo.png</url>
      <title>Báo Thử Nghiệm - tiêu đề của ảnh</title>
      <link>https://news.example.vn</link>
    </image>
    <pubDate>Thu, 24 Sep 2026 15:10:45 +0700</pubDate>
    <link>https://news.example.vn/rss/tin-moi-nhat.rss</link>
    <language>vi</language>
    <item>
      <title>Mưa lớn ở Hà Nội &amp; các tỉnh lân cận</title>
      <description><![CDATA[<a href="https://news.example.vn/mua-lon-1.html"><img src="https://img.example.vn/1.jpg?w=1200&h=0"></a></br>Nhiệt độ giảm nhẹ, trời có mưa rào vào chiều tối.]]></description>
      <pubDate>Thu, 24 Sep 2026 15:03:35 +0700</pubDate>
      <link>https://news.example.vn/mua-lon-1.html</link>
      <guid>https://news.example.vn/mua-lon-1.html</guid>
    </item>
    <item>
      <title><![CDATA[Giá xăng <b>giảm</b> từ chiều nay]]></title>
      <description><![CDATA[<p>Mỗi lít giảm vài trăm đồng.</p>]]></description>
      <pubDate>Thu, 24 Sep 2026 16:30:00 +0700</pubDate>
      <link>https://news.example.vn/gia-xang-2.html</link>
      <guid>https://news.example.vn/gia-xang-2.html</guid>
    </item>
    <item>
      <title>Đội tuyển thắng trận mở màn</title>
      <description>&lt;p&gt;Bàn thắng duy nhất ở phút 90&amp;#8217;.&lt;/p&gt;</description>
      <pubDate>Wed, 23 Sep 2026 21:00:00 +0700</pubDate>
      <link>https://news.example.vn/the-thao-3.html</link>
      <guid>https://news.example.vn/the-thao-3.html</guid>
      <author>toa-soan@example.vn (Phóng viên Thể thao)</author>
    </item>
  </channel>
</rss>`;

/** GitHub's release feed shape: Atom, `xml:lang`, alternate and self links,
 *  `content type="html"` escaped, `updated` and no `published`. */
export const ATOM_RELEASES = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <id>tag:code.example.org,2008:https://code.example.org/acme/widget/releases</id>
  <link type="text/html" rel="alternate" href="https://code.example.org/acme/widget/releases"/>
  <link type="application/atom+xml" rel="self" href="https://code.example.org/acme/widget/releases.atom"/>
  <title>Release notes from widget</title>
  <updated>2026-09-08T13:15:03Z</updated>
  <entry>
    <id>tag:code.example.org,2008:Repository/1/v1.2.0</id>
    <updated>2026-09-08T13:17:43Z</updated>
    <link rel="alternate" type="text/html" href="https://code.example.org/acme/widget/releases/tag/v1.2.0"/>
    <title>v1.2.0</title>
    <content type="html">&lt;h3&gt;Changes&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;feat: a &lt;code&gt;faster&lt;/code&gt; path (&lt;a href=&quot;https://code.example.org/acme/widget/pull/7&quot;&gt;#7&lt;/a&gt;)&lt;/li&gt;
&lt;/ul&gt;</content>
    <author><name>maintainer</name></author>
    <media:thumbnail height="30" width="30" url="https://avatars.example.org/u/1"/>
  </entry>
  <entry>
    <id>tag:code.example.org,2008:Repository/1/v1.1.0</id>
    <updated>2026-08-30T09:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://code.example.org/acme/widget/releases/tag/v1.1.0"/>
    <title>v1.1.0</title>
    <content type="html">&lt;p&gt;Fixes.&lt;/p&gt;</content>
  </entry>
</feed>`;

/** Atom's harder corners: `xml:base` resolving a relative link, an XHTML
 *  content block, a `type="html"` title, and a `type="text"` summary whose
 *  angle brackets are text. */
export const ATOM_CORNERS = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://blog.example.org/">
  <title type="html">Notes &lt;i&gt;and&lt;/i&gt; Asides</title>
  <link href="/"/>
  <entry xml:base="/posts/">
    <title>Comparing things</title>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <link href="compare"/>
    <published>2026-09-20T08:00:00+07:00</published>
    <updated>2026-09-21T08:00:00+07:00</updated>
    <summary type="text">When a &lt; b and b &lt; c</summary>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>X &lt; Y, <em>always</em>.</p></div></content>
  </entry>
  <entry>
    <title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">An <b>xhtml</b> title</div></title>
    <id>urn:uuid:2</id>
    <link rel="alternate" href="https://blog.example.org/posts/two"/>
    <link rel="enclosure" href="https://blog.example.org/audio.mp3"/>
    <updated>2026-09-19</updated>
  </entry>
</feed>`;

/** RSS 1.0: items are siblings of the channel, identity is `rdf:about`, dates
 *  are Dublin Core. */
export const RDF_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://science.example.net/">
    <title>Science Wire</title>
    <link>https://science.example.net/</link>
    <dc:language>en-GB</dc:language>
  </channel>
  <item rdf:about="https://science.example.net/story/1">
    <title>A comet, again</title>
    <link>https://science.example.net/story/1</link>
    <description>It came back.</description>
    <dc:date>2026-09-22T10:00:00Z</dc:date>
    <dc:creator>Staff</dc:creator>
  </item>
  <item rdf:about="https://science.example.net/story/2">
    <title>A quieter week</title>
    <dc:date>2026-09-23T10:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

/** A feed that dates nothing, identifies entries only by link or title, and
 *  has one entry with nothing at all. */
export const RSS_UNDATED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Undated</title>
  <link>https://undated.example.com/</link>
  <item><title>First</title><link>https://undated.example.com/1</link></item>
  <item><title>Second, link only in guid</title><guid>https://undated.example.com/2</guid></item>
  <item><title>Third, a guid that is not a link</title><guid isPermaLink="false">abc-3</guid></item>
  <item><title>Fourth, title only</title></item>
  <item><description>Nothing to call it by.</description></item>
  <item><title>First</title><link>https://undated.example.com/1</link></item>
</channel></rss>`;

/** A document type that declares an entity. No feed needs one (doc 15 §5). */
export const RSS_WITH_ENTITIES = `<?xml version="1.0"?>
<!DOCTYPE rss [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<rss version="2.0"><channel><title>&lol2;</title></channel></rss>`;

/** The same, with a decoy root inside a comment before the declaration — the
 *  prolog check has to look past comments or this walks straight through. */
export const RSS_ENTITIES_BEHIND_A_COMMENT = `<?xml version="1.0"?>
<!-- <rss> -->
<!DOCTYPE rss [<!ENTITY x "x">]>
<rss version="2.0"><channel><title>&x;</title></channel></rss>`;

/** A captive portal, or a maintenance page served with a 200. */
export const HTML_PAGE = `<!doctype html>
<html lang="en"><head><title>Sign in to Wi-Fi</title></head>
<body><p>Please accept the terms to continue.</p></body></html>`;

/** An RSS 2.0 feed with `count` dated items, the newest last in the document. */
export function rssWithItems(count: number): string {
	const items = Array.from({ length: count }, (_, index) => {
		const day = String(1 + (index % 28)).padStart(2, '0');
		const hour = String(index % 24).padStart(2, '0');
		return `<item><title>Item ${index}</title><link>https://many.example.com/${index}</link><pubDate>${day} Aug 2026 ${hour}:00:00 GMT</pubDate></item>`;
	}).join('');
	return `<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>${items}</channel></rss>`;
}

/** A Latin-1 feed, as bytes: `é` is the single byte 0xE9, which UTF-8 would
 *  read as a replacement character. */
export function latin1Feed(): Uint8Array {
	const head = '<?xml version="1.0" encoding="ISO-8859-1"?><rss version="2.0"><channel><title>Caf';
	const tail = '</title></channel></rss>';
	return Uint8Array.from(
		[...head]
			.map((c) => c.charCodeAt(0))
			.concat(
				[0xe9],
				[...tail].map((c) => c.charCodeAt(0))
			)
	);
}

/** Tuổi Trẻ's shape: CDATA everywhere, a `lastBuildDate` that names `GMT+7`,
 *  and item dates in .NET's `M/D/YYYY h:mm:ss AM` that name no zone at all. */
export const RSS_ZONELESS_ITEMS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title><![CDATA[BÁO THỬ - RSS Feed]]></title><link><![CDATA[https://tt.example.vn/home.htm]]></link><language>vi-vn</language><lastBuildDate>Thu, 24 Sep 2026 21:49:47 GMT+7</lastBuildDate><item><title><![CDATA[Tin tối nay]]></title><link><![CDATA[https://tt.example.vn/tin-toi-nay.htm]]></link><pubDate>9/24/2026 9:41:00 PM</pubDate></item><item><title><![CDATA[Tin sáng nay]]></title><link><![CDATA[https://tt.example.vn/tin-sang-nay.htm]]></link><pubDate>9/24/2026 8:05:00 AM</pubDate></item></channel></rss>`;

/** BBC's shape: a link whose query is escaped in the XML, as it must be. */
export const RSS_ESCAPED_LINKS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Escaped</title><link>https://www.example.co.uk/news</link><item><title>One</title><link>https://www.example.co.uk/news/articles/1?at_medium=RSS&amp;at_campaign=rss</link><guid isPermaLink="false">https://www.example.co.uk/news/articles/1#0&amp;1</guid><pubDate>Thu, 24 Sep 2026 14:58:51 GMT</pubDate></item></channel></rss>`;
