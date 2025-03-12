<img src="https://raw.githubusercontent.com/dnl-fm/done/main/done.jpg?sanitize=true" alt="Done logo" width="350" align="right" style="max-width: 40vw;">

# Message sent? Done!

[![Join Discord](https://discord.com/api/guilds/1177611308129075281/widget.png?style=shield)](https://discord.gg/JEYJbQgnWp)
[![MPL-2.0](https://img.shields.io/crates/l/kobold.svg?label=)](https://www.mozilla.org/en-US/MPL/)

_Done: Your straightforward message queue solution, open-source and self-hosted on Deno Deploy._

__Key features:__
- Open Source
- Self-Hosting via Deno Deploy
- Delayed messages without limits
- Retry handling
- Failure-Callbacks
- Dead Letter Queues

## Content

- [Introduction](#introduction)
- [Features](#features)
- [What about Deno's native queue?](#what-about-denos-native-queue)
- [Setup on Deno Deploy](#setup-on-deno-deploy)
- [API Endpoints](#api-endpoints)
- [Credits](#credits)
- [Who is DNL](#who-is-dnl)
- [Feedback](#feedback)
- [License](#license)

## Introduction

Done isn't just another message queue service; it's a celebration of simplicity and open-source ingenuity. It's perfect for those who like their tech like they like their coffee: strong, straightforward, and capable of keeping you up at night (in a good way, we promise!).

Embrace the open-source simplicity with Done. Queue up, have fun, and get it done! 

- 📡 RESTful API, Joyful You: Manage your queues with a RESTful API that's as simple as a light switch – on, off, and awesome.
- 🧰 No-Frills, All Thrills: We've cut the fluff, leaving you with a lean, mean, message-queuing machine.
- 🦕 Deno-Deploy-Powered: With its foundation in Deno, Done is as awesome as a dinosaur rocking shades. That's right, we're keeping it that cool ;)

## Features

### Storage Options

Done supports two storage backends:

1. **Deno KV (Default)**: Uses Deno's built-in key-value store for all data storage.
2. **Turso**: Stores data in SQLite (locally for development) or Turso's distributed SQLite service (for production).

Each storage backend is optimized with a specialized implementation:
- **KV Storage**: Uses a key-value model with secondary indexes for efficient lookups.
- **Turso Storage**: Leverages SQL's native query capabilities for efficient data retrieval and manipulation.

To configure the storage backend, set the following environment variables:

```
# Choose storage type: 'kv' or 'turso'
STORAGE_TYPE=kv

# For Turso storage
TURSO_DB_URL=https://your-db.turso.io  # Optional: defaults to local SQLite file if not provided
TURSO_AUTH_TOKEN=your-auth-token       # Optional: only needed for Turso cloud
```

For local development with Turso, you can use an in-memory database by setting `TURSO_DB_URL=:memory:` or a local file with `TURSO_DB_URL=file:turso.db`.

### Absolute Delay

```ts
await fetch('https://your-done-host.com/http://your-callback-url.com/some-path/123456789', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ******',
    'Done-Not-Before': 1700902800, // 2023-11-25T09:00:00Z
    'Content-type': 'application/json'
  },
  body: JSON.stringify({name: 'Foo Bar', email: 'foo@bar.com'})
});
```
__Expected response__
You will receive a message-id as well as the set date of callback.

```ts
201 Created

{
  "id": "msg_ytc6tbklsjmurie7ppxtqfnreh",
  "publishAt": "2023-11-25T09:00:00Z"
}
```
__Expected callback at `2023-11-25T09:00:00Z`__
Your actual callback message.

```ts
POST http://your-callback-url.com/some-path/123456789
done-message-id: msg_ytc6tbklsjmurie7ppxtqfnreh
done-status: deliver
done-retried: 0
user-agent: Done Light

{
  "name": "Foo Bar",
  "email": "foo@bar.com"
}
```

### Relative Delay

You sent a request at `2023-11-25T09:00:00Z`.

```ts
await fetch('https://your-done-host.com/http://your-callback-url.com/some-path/123456789', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ******',
    'Done-Delay': '5m', // in 5 minutes
    'Content-type': 'application/json'
  },
  body: JSON.stringify({name: 'Foo Bar', email: 'foo@bar.com'})
});
```
__Expected response__
You will receive a message-id as well as the calculated date of callback.

```ts
201 Created

{
  "id": "msg_ytc6tbklsjmurie7ppxtqfnreh",
  "publishAt": "2023-11-25T09:05:00Z"
}
```
__Expected callback at `2023-11-25T09:05:00Z`__
Your actual callback message.

```ts
POST http://your-callback-url.com/some-path/123456789
done-message-id: msg_ytc6tbklsjmurie7ppxtqfnreh
done-status: deliver
done-retried: 0
user-agent: Done Light

{
  "name": "Foo Bar",
  "email": "foo@bar.com"
}
```
__Delay format__

The format for this type of delay is `<number><unit>`. Valid units are:

- seconds (s)
- minutes (m)
- hours (h)
- days (d)

_Some delay examples:_

- `10s` (enough to catch your breath),
- `5m` (perfect for a quick coffee),
- `20m` (ideal for a power nap),
- `2h` (great for binge-watching your favorite show),
- `14d` (for those who plan way ahead).

### Immediate messages

No `Delay` header? No delay! Done will callback immediately as it receives the message. You sent a request at `2023-11-25T09:00:00Z`.

```ts
await fetch('https://your-done-host.com/http://your-callback-url.com/some-path/123456789', {
  method: 'POST',
  headers: {'Authorization': 'Bearer ******'}
});
```

__Expected response__
You will receive a message-id as well as the calculated date of callback.

```ts
201 Created

{
  "id": "msg_ytc6tbklsjmurie7ppxtqfnreh",
  "publishAt": "2023-11-25T09:00:00Z"
}
```
__Expected callback immediate after `2023-11-25T09:00:00Z`__
Your actual callback message.

```ts
POST http://your-callback-url.com/some-path/123456789
done-message-id: msg_ytc6tbklsjmurie7ppxtqfnreh
done-status: deliver
done-retried: 0
user-agent: Done Light
```

### Callback headers

You can attach callback headers which Done will integrate when calling you back. Just flag these with `Done-`.

```ts
// callback headers

await fetch('https://your-done-host.com/http://your-callback-url.com/some-path/123456789', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ******',
    'Content-type': 'application/json',
    'Done-Authorization': 'Bearer *********'
    'Done-Foo': 'bar',
  },
  body: JSON.stringify({name: 'Foo Bar', email: 'foo@bar.com'})
});
```
__Expected callback message__

```ts
POST http://your-callback-url.com/some-path/123456789
Authorization: Bearer *********
foo: bar
done-message-id: msg_ytc6tbklsjmurie7ppxtqfnreh
done-status: deliver
done-retried: 0
user-agent: Done Light

{
  "name": "Foo Bar",
  "email": "foo@bar.com"
}
```

### Retries and Failure-Callback

By default Done will try 3 times to call the specified message url. If that does not work and the message included a `Done-Failure-Callback`-header it will try to send the message to that given URL before moving it to the `Dead Letter Queue`.

```ts
await fetch('https://your-done-host.com/http://your-callback-url.com/some-path/123456789', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ******',
    'Content-type': 'application/json',
    'Done-Failure-Callback': 'http://your-callback-url.com/failure/123456789',
  },
  body: JSON.stringify({name: 'Foo Bar', email: 'foo@bar.com'})
});
```

## What about Deno's native Queue?

[Deno's native queue](https://deno.com/blog/queues) is super handy for instant action in your Deno Deploy projects, like firing emails or sending requests on the fly. But when it comes to tracking those enqueued little critters, it's like herding cats. You'd have to play double duty, shuffling each message into a KV store and keeping tabs on their every move. Thinking of delaying a message? You've got a week, max. That's it.

Enter Done - your new best bud in the messaging realm. This isn't just another tool; it's a developer's dream sidekick _\*cough\*_. Picture it stepping out of Deno's shadow, ready to serve any app, anywhere. Done keeps an eagle eye on all messages and their states, making callbacks with custom headers to any external service like it's no big deal.

And when it comes to delays, Done laughs in the face of 7-day limits. Whether you're plotting to send a "see you in two months" email or scheduling an invoice way down the line, Done's your time-traveling ally. No delay cap, just boundless possibilities.

So, here's the deal: Done is unapologetically developer-friendly. No complicated setups, no riddles to solve. It's as transparent and straightforward as it gets. Just the way you like it.

__P.S. Big shoutout to the Deno team! Without Deno Queues and Deno KV, this tool would've been a no-go. Huge thanks for their fantastic work – couldn't have done it without them!__ 🙌🦕

## Setup on Deno Deploy

Setup a project over at [Deno Deploy](https://deno.com/deploy). Either you deploy Done yourself or you connect it with your Github repository to deploy it automatically.

When this is "done", all you need is an environment variable `AUTH_TOKEN` which you can create in your project settings. With that _Done_ can validate your authorization bearer token against that env variable.

Starting from v1.1.0, you can also add `ENABLE_LOGS=true` to your environment variable to control logging. By default, logging is disabled. This should save about 2/3 of your KV writes.
So, if saving KV writes is your thing, keep it stealthy; otherwise, let the logs roar!

With that, you've got everything in place like a squirrel with a perfectly organized nut collection before winter! 🐿️

## API Endpoints

There are a couple of API endpoints defined as a [bruno collection](https://github.com/usebruno/bruno). The collection can be [found here](docs/bruno-collection/).

There is also another helping hand in the game: [gotrequests.com](https://github.com/dnl-fm/gotrequests.com). Just like our mentioned diligent squirrel preparing for winter by collecting nuts, it helps you collect incoming requests with all their attached data. Before you connect your real-world projects, use `gotrequests.com` to simulate how a callback from _Done_ would look. It's like making sure every nut is in place before your project launches!

## Credits

Done is inspired by [Upstash's Qstash](https://upstash.com/docs/qstash/overall/getstarted) message queue. It's great but I thought, 'Nice, but how about a bit more love?' You know, like a unicorn in a world of horses. So, I added open source, some sprinkle of developer-friendly magic as well as home-brewability.

While Qstash is the reliable sedan, Done is the fun convertible with the top down, zooming past limitations and honking with joy at every turn!


### Who is DNL?

DNL, short for 'Dots and Lines', is a venture created by Tino Ehrich, a seasoned digital carpenter with over 20 years of experience in crafting projects and assisting businesses. DNL will specifically focus on developing projects that aim to simplify the access of information, and to develop these in the open.

## Feedback

I would love to get your feedback. Drop by [Done's Discord Channel](https://discord.gg/JEYJbQgnWp). Hope to talk soon!

## License

Done is free software, and is released under the terms of the [Mozilla Public License](https://www.mozilla.org/en-US/MPL/) version 2.0. See [LICENSE](LICENSE).
