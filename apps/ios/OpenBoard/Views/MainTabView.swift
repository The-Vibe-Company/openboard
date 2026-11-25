import SwiftUI

struct MainTabView: View {
    @Environment(BoardStore.self) private var store
    @State private var selectedTab = 0

    private var openTaskCount: Int {
        store.boardTasks.filter { $0.message.task?.state.isOpen == true }.count
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            ChannelsTabView()
                .tabItem {
                    Label("Channels", systemImage: "number")
                }
                .tag(0)

            TasksTabView()
                .tabItem {
                    Label("Tasks", systemImage: "checklist")
                }
                .badge(openTaskCount > 0 ? openTaskCount : 0)
                .tag(1)

            ActivityTabView()
                .tabItem {
                    Label("Activity", systemImage: "waveform.path.ecg")
                }
                .tag(2)

            SettingsTabView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
                .tag(3)
        }
        .background(OBTheme.background)
    }
}
