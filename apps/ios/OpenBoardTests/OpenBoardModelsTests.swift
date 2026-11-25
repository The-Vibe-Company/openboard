import XCTest
@testable import OpenBoard

final class OpenBoardModelsTests: XCTestCase {
    func testDecodesMeResponse() throws {
        let json = """
        {
          "actor": "act_stan",
          "principal": "pri_stan",
          "kind": "person",
          "handle": "stan",
          "name": "Stan Girard",
          "avatar": "https://avatars.githubusercontent.com/u/19614572?v=4",
          "openboard": {
            "org": { "slug": "tvc", "name": "The Vibe Company" },
            "board": { "slug": "main", "name": "main" },
            "role": "owner",
            "credential": "personal"
          }
        }
        """
        let me = try JSONDecoder().decode(MeResponse.self, from: Data(json.utf8))
        XCTAssertEqual(me.handle, "stan")
        XCTAssertEqual(me.kind, .person)
        XCTAssertEqual(me.openboard?.org.slug, "tvc")
        XCTAssertEqual(me.openboard?.board.slug, "main")
    }

    func testDecodesTaskSummaryAndSortsDoneNewestFirst() throws {
        let json = """
        {
          "tasks": [
            {
              "message": {
                "id": "5",
                "channel": "openboard",
                "text": "Older done task",
                "mentions": [],
                "re": null,
                "replyTo": null,
                "thread": "5",
                "labels": { "board.task": "completed", "area": "release" },
                "reactions": { "rocket": ["act_1"] },
                "by": { "actor": "act_1", "principal": "pri_1", "profile": null },
                "from": "Stan",
                "createdAt": "2026-11-24T10:00:00.000Z",
                "editedAt": null,
                "deleted": false,
                "attachments": [],
                "version": 20,
                "task": {
                  "state": "completed",
                  "owner": "act_1",
                  "by": "act_1",
                  "for": null,
                  "needs": [],
                  "epoch": 1,
                  "claim": null,
                  "blocked": null,
                  "result": "Published 0.4.0",
                  "reason": null
                },
                "revision": 3,
                "author": { "kind": "person", "handle": "stan", "name": "Stan Girard", "avatar": null, "via": null }
              },
              "replies": 2,
              "last": null
            },
            {
              "message": {
                "id": "182",
                "channel": "openboard",
                "text": "Newer done task",
                "mentions": [],
                "re": null,
                "replyTo": null,
                "thread": "182",
                "labels": { "board.task": "completed" },
                "reactions": {},
                "by": { "actor": "act_1", "principal": "pri_1", "profile": null },
                "from": "Stan",
                "createdAt": "2026-11-25T22:00:00.000Z",
                "editedAt": null,
                "deleted": false,
                "attachments": [],
                "version": 99,
                "task": {
                  "state": "completed",
                  "owner": "act_1",
                  "by": "act_1",
                  "for": null,
                  "needs": ["5"],
                  "epoch": 1,
                  "claim": null,
                  "blocked": null,
                  "result": "Shipped",
                  "reason": null
                },
                "revision": 2,
                "author": { "kind": "person", "handle": "stan", "name": "Stan Girard", "avatar": null, "via": null }
              },
              "replies": 0,
              "last": null
            }
          ],
          "cursor": "99"
        }
        """
        let page = try JSONDecoder().decode(TasksResponse.self, from: Data(json.utf8))
        XCTAssertEqual(page.tasks.count, 2)
        XCTAssertEqual(page.tasks[0].message.visibleLabels.count, 1)
        XCTAssertEqual(page.tasks[0].message.visibleLabels[0].key, "area")

        let sorted = page.tasks.sorted { BoardStore.doneOrder($0, $1) }
        XCTAssertEqual(sorted.map(\.id), ["182", "5"])
    }

    func testSSEDecoderDispatchesOnBlankLine() {
        let stream = """
        : keepalive\r\n
        id: 42\r\n
        event: board\r\n
        data: {"cursor":"42","type":"channel.created","createdAt":"2026-11-25T22:00:00.000Z","message":null,"payload":{"channel":"mobile","thread":null,"name":null,"handle":null,"error":null,"by":null}}\r\n
        \r\n
        """
        var decoder = SSEStreamDecoder()
        var decoded: [(id: String?, event: BoardEvent)] = []
        for byte in stream.utf8 {
            if let frame = decoder.consume(byte: byte) {
                decoded.append(frame)
            }
        }
        XCTAssertEqual(decoded.count, 1)
        XCTAssertEqual(decoded[0].id, "42")
        XCTAssertEqual(decoded[0].event.type, "channel.created")
        XCTAssertEqual(decoded[0].event.channelPath, "mobile")
        XCTAssertEqual(decoded[0].event.summaryText, "Created channel #mobile")
    }

    func testPreviewLineStripsMarkdownAndResolvesMentions() {
        let mentions = [
            MessageMention(
                written: "@act_1",
                actor: .init(id: "act_1", handle: "stan", name: "Stan Girard")
            )
        ]
        let preview = TextFormatting.previewLine("## **Ship** `@act_1` iOS\nSecond line", mentions: mentions, fallback: "Thread")
        XCTAssertEqual(preview, "Ship @stan iOS")
    }
}
