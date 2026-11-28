# ViewLive Feature Test

A single document that exercises every Markdown construct the preview should handle.

## Table of Contents

- [Headings](#headings)
- [Inline Formatting](#inline-formatting)
- [Lists](#lists)
- [Task Lists](#task-lists)
- [Tables](#tables)
- [Code](#code)
- [Blockquotes and Alerts](#blockquotes-and-alerts)
- [Details / Summary](#details--summary)
- [Links and Images](#links-and-images)
- [Math](#math)
- [Raw HTML](#raw-html)
- [Edge Cases](#edge-cases)

---

## Headings

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

Setext H1
=========

Setext H2
---------

## Inline Formatting

Plain text, **bold**, __bold alt__, *italic*, _italic alt_, ***bold italic***, ~~strikethrough~~, `inline code`, and **bold with `code` and *italic* inside**.

Escaped characters: \*not italic\*, \`not code\`, \# not a heading, \[not a link\].

Unicode and umlauts: Ä Ö Ü ä ö ü ß, € £ ¥, → ← ↑ ↓, ✓ ✗, 😀 🚀 🎉

Line with a hard break (two trailing spaces)  
continues here.

Line with a backslash break\
continues here.

Superscript via HTML: x<sup>2</sup>, subscript: H<sub>2</sub>O, <kbd>Ctrl</kbd> + <kbd>S</kbd>, <mark>highlighted</mark>.

Footnote reference[^1] and another one[^note].

[^1]: This is the first footnote.
[^note]: Named footnote with **formatting**.

## Lists

### Unordered with `*`

* Item one
* Item two
  * Nested item
  * Nested item
    * Third level
      * Fourth level
* Item three

### Unordered with `-`

- Apple
- Banana
  - Yellow
  - Green
    - Very green
- Cherry

### Unordered with `+`

+ First
+ Second
  + Nested

### Ordered

1. First
2. Second
   1. Sub one
   2. Sub two
      1. Sub sub
3. Third

### Ordered starting at 5

5. Five
6. Six
7. Seven

### Ordered with `)`

1) Alpha
2) Beta

### Mixed nesting

1. Ordered parent
   - Unordered child
   - Another child
     1. Ordered grandchild
     2. Ordered grandchild
   * Star child
2. Second parent
   > A quote inside a list item

   ```js
   console.log("code inside a list item");
   ```

### Loose list (blank lines between items)

- Paragraph item one

- Paragraph item two

  With a second paragraph.

- Paragraph item three

## Task Lists

- [ ] Open task
- [x] Done task
- [X] Done task (uppercase X)
- [ ] Parent task
  - [x] Done subtask
  - [ ] Open subtask
    - [ ] Deep subtask
* [ ] Task with `*`
* [x] Done task with `*`
1. [ ] Ordered task
2. [x] Ordered done task

## Tables

### Basic

| Name    | Role      | Age |
| ------- | --------- | --- |
| Alice   | Developer | 30  |
| Bob     | Designer  | 25  |
| Charlie | Manager   | 41  |

### Alignment

| Left | Center | Right |
| :--- | :----: | ----: |
| a    |   b    |     c |
| long left text | centered | 1234.56 |
| x    |   y    |     7 |

### Inline formatting in cells

| Feature | Example | Status |
| ------- | ------- | :----: |
| Bold | **strong** | ✓ |
| Code | `npm run build` | ✓ |
| Link | [VS Code](https://code.visualstudio.com) | ✓ |
| Escaped pipe | a \| b | ✓ |
| Strike | ~~old~~ new | ✗ |

### Numbers (for sort testing)

| Item | Count | Price |
| ---- | ----: | ----: |
| Zebra | 10 | 2.50 |
| apple | 2 | 10.00 |
| Mango | 100 | 0.99 |
| banana | 1 | 5.25 |

### Single column

| Only |
| ---- |
| one  |
| two  |

### Empty cells

| A | B | C |
| - | - | - |
| 1 |   | 3 |
|   | 2 |   |

## Code

Inline: `const x = 42;`

Indented code block:

    function indented() {
        return true;
    }

Fenced without language:

```
plain fenced block
  keeps   spacing
```

```typescript
interface User {
  id: number;
  name: string;
}

export function greet(user: User): string {
  return `Hello, ${user.name}!`;
}
```

```python
def fib(n: int) -> int:
    """Return the n-th Fibonacci number."""
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
```

```json
{
  "name": "viewlive",
  "version": "0.0.1",
  "enabled": true,
  "tags": ["markdown", "preview"]
}
```

```bash
pnpm install
pnpm run compile && echo "done"
```

```css
.preview h1 {
  color: #333;
  border-bottom: 1px solid #eee;
}
```

```html
<div class="card">
  <p>Hello <strong>world</strong></p>
</div>
```

```diff
- removed line
+ added line
  unchanged line
```

~~~
Tilde fence
~~~

## Blockquotes and Alerts

> A simple blockquote.

> Multi-line blockquote
> continues here.
>
> Second paragraph.
>
> > Nested quote
> > > Third level

> ### Heading in quote
> - list in quote
> - `code` in quote

> [!NOTE]
> Useful information.

> [!TIP]
> Helpful advice.

> [!IMPORTANT]
> Key information.

> [!WARNING]
> Urgent info that needs attention.

> [!CAUTION]
> Negative consequences of an action.

## Details / Summary

<details>
<summary>Click to expand</summary>

Hidden content with **Markdown** inside.

- List item
- Another item

```js
console.log("code in details");
```

</details>

<details open>
<summary>Open by default</summary>

This block starts expanded.

</details>

<details>
<summary><strong>Formatted</strong> summary</summary>

<details>
<summary>Nested details</summary>

Inner content.

| Col | Val |
| --- | --- |
| a   | 1   |

</details>

</details>

<details>
<summary>Empty body</summary>
</details>

## Links and Images

Inline link: [VS Code](https://code.visualstudio.com)

Link with title: [GitHub](https://github.com "GitHub Homepage")

Autolink: <https://example.com>

Bare URL: https://example.com/path?query=1

Email: <someone@example.com>

Reference link: [reference][ref] and [collapsed][].

[ref]: https://example.com/reference
[collapsed]: https://example.com/collapsed

Anchor link: [Jump to Tables](#tables)

Relative link: [README](../README.md)

Image:

![Placeholder](https://via.placeholder.com/150 "Placeholder image")

Relative image (may be broken on purpose):

![Missing](./does-not-exist.png)

Linked image:

[![Badge](https://img.shields.io/badge/test-passing-green)](https://example.com)

## Math

> Note: ViewLive currently has no math renderer; these lines show how raw math source appears.

Inline: $E = mc^2$, $a^2 + b^2 = c^2$, $\alpha + \beta = \gamma$

Block:

$$
\int_{0}^{\infty} e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

$$
A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
$$

Fenced math:

```math
f(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
```

Plain Unicode math symbols: ∑ ∏ ∫ √ ∞ ≈ ≠ ≤ ≥ ± × ÷ ∈ ∉ ⊂ ⊆ ∪ ∩ ∀ ∃ ∂ ∇ π θ λ μ σ Ω

Dollar signs that are not math: costs $5 and $10.

## Raw HTML

<div align="center">
  <h3>Centered HTML heading</h3>
  <p>Paragraph inside a <code>div</code>.</p>
</div>

<table>
  <thead>
    <tr><th>HTML</th><th>Table</th></tr>
  </thead>
  <tbody>
    <tr><td rowspan="2">Rowspan</td><td>One</td></tr>
    <tr><td>Two</td></tr>
    <tr><td colspan="2">Colspan across both</td></tr>
  </tbody>
</table>

<p>Inline <span style="color: tomato;">colored span</span> and <abbr title="HyperText Markup Language">HTML</abbr>.</p>

<dl>
  <dt>Term</dt>
  <dd>Definition of the term.</dd>
</dl>

<br>

<img src="https://via.placeholder.com/80" alt="HTML image" width="80">

<!-- This HTML comment should not be visible -->

## Horizontal Rules

---

***

___

## Edge Cases

Empty lines follow:



Text after multiple empty lines.

A very long line without breaks: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

AVeryLongWordWithoutAnySpacesThatShouldWrapOrOverflowSomehowAVeryLongWordWithoutAnySpacesThatShouldWrapOrOverflowSomehow

Trailing spaces and tabs	in	text.

**Unclosed bold

*Unclosed italic

`Unclosed code

[Unclosed link](

<div>Unclosed HTML

1. List directly after text
- Switching list marker
* Switching again

Last line without trailing newline.