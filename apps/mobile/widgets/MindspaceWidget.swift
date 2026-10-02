import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), streak: 5)
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let entry = SimpleEntry(date: Date(), streak: 5)
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let userDefaults = UserDefaults(suiteName: "group.app.mindspace.client.expowidgets")
        let widgetDataStr = userDefaults?.string(forKey: "widgetData") ?? "{}"
        
        var streak = 0
        if let data = widgetDataStr.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
           let storedStreak = json["streak"] as? Int {
            streak = storedStreak
        }
        
        let entry = SimpleEntry(date: Date(), streak: streak)
        
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let streak: Int
}

struct MindspaceWidgetEntryView : View {
    var entry: Provider.Entry

    var body: some View {
        ZStack {
            Color(red: 11/255, green: 16/255, blue: 38/255) // #0B1026
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Mindspace")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color(white: 0.7))
                
                Spacer()
                
                Text("\(entry.streak) Day Streak")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
                
                Text(entry.streak > 0 ? "You're doing great!" : "Time to breathe.")
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding()
        }
        // The whole widget starts today's session. Opening the app to whatever
        // screen it was last on wastes the one tap the user was willing to
        // spend — this is the shortest path there is from intent to audio.
        .widgetURL(URL(string: "mindspace://start"))
    }
}

@main
struct MindspaceWidget: Widget {
    let kind: String = "MindspaceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            MindspaceWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Mindspace")
        .description("Track your meditation streaks.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
