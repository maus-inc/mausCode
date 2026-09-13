---
name: Document contradicts the tree
about: A file an agent or human reads before working says something the code does not
title: "Docs: "
labels: documentation
assignees: ""
---

<!--
Use this for drift, not for prose taste. Drift is when a claim in a document is false
against the current tree. The value of the report is the measurement, so every claim needs
the command that produced it and the date it was taken.

Fixes here follow one rule from AGENTS.md: when a documented path disagrees with the tree,
the tree wins and the same change corrects the document.
-->

## Which document

Path, and the section or line range.

## What it claims

Quote the sentence, do not paraphrase it.

## What is actually true

The measured state, with the command that produced it and its output.

```sh

```

## Who is harmed

What an agent or a new contributor would do because of the claim, and the cost.

## Files to change

| File | Change |
| --- | --- |

List every document that repeats the claim, including the `.dump` copy of it. A fix that
updates one of two copies creates a second drift.

## Out of scope

What this change must not touch, so a doc fix does not become a behaviour change.
