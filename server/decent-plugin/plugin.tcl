# Kaffeebibliothek: schickt nach jedem Espresso das Shot-JSON (::shot::create) an die eigene Kaffeebibliothek im Heimnetz.
# Dazu einmal die ganze Historie (history/, history_v2/, profiles/, profiles_v2/) und danach jede neue oder geänderte Datei,
# damit alles im Heimnetz liegt und nicht nur auf dem Tablet. Gesendetes steht in sent.txt neben settings.tdb.
# Profile der Kaffees („# Rösterei - Kaffee“, Datei beginnt mit _): alle paar Sekunden nur die seit dem letzten Stand geänderten
# der App nach profiles/ holen und am Tablet geänderte eigene zurückschicken (nicht während Espresso, Dampf, Heißwasser); alle paar
# Minuten die ganze Historie und alle Profile. Andere Dateien schreibt es nie; ein am Tablet jüngeres Profil bleibt und geht zurück.
# Alle Werte stehen in den Plugin-Einstellungen (DEFAULTS sind nur die Vorgaben, bis dort etwas eingetragen ist).
# Installation: Ordner "kaffeebibliothek" nach de1plus/plugins/ kopieren, de1app neu starten, unter Erweiterungen einschalten.
# Die Adresse steht in settings.tdb (beim Laden aus der App schon eingetragen) und lässt sich in den Plugin-Einstellungen ändern.
package require http
catch { package require tls }

set plugin_name "kaffeebibliothek"

namespace eval ::plugins::${plugin_name} {
    variable author "Kaffeebibliothek"
    variable contact ""
    variable version 1.6
    variable description "Schickt jeden Espresso mit Kurve, Dosis, Ausbeute und Zeit und die ganze Shot-Historie an die Kaffeebibliothek"
    variable name "Kaffeebibliothek"

    variable pending {}
    variable attempt 0

    # Historie: Warteschlange, Fortschritt, gesendete Dateien (Pfad -> "mtime größe")
    variable queue {}
    variable busy 0
    variable quiet 0
    variable done_n 0
    variable failed_n 0
    variable total_n 0
    variable sent
    array set sent {}
    variable sent_loaded 0
    variable pulling 0
    # höchster Stand der App-Profile, die schon da sind (für ?since=)
    variable pstand 0

    # Einstellung -> Vorgabe
    variable DEFAULTS {
        url {}
        min_seconds 8
        skip_types {cleaning calibrate}
        wait_s 2
        retries 5
        retry_pause_s 5
        timeout_s 30
        history_dirs {history_v2 history profiles_v2 profiles}
        history_start_s 60
        history_after_shot_s 30
        history_retry_min 10
        toast_every 50
        profile_sync_s 10
        history_sync_min 5
    }
    # Dateien je Ordner der App
    variable PATTERNS {history_v2 *.json history *.shot profiles_v2 *.json profiles *.tcl}

    # Zahl aus den Einstellungen, sonst die Vorgabe
    proc num { key } {
        variable settings
        variable DEFAULTS
        set v [string trim [ifexists settings($key)]]
        if { [string is double -strict $v] && $v >= 0 } { return $v }
        return [dict get $DEFAULTS $key]
    }

    proc ms { key } { return [expr { int([num $key] * 1000) }] }

    proc msg { args } {
        catch { ::msg [namespace current] {*}$args }
    }

    proc save {} {
        catch { save_plugin_settings kaffeebibliothek }
    }

    proc status { text } {
        variable settings
        set settings(last_result) $text
        save
        catch { ::plugins::kaffeebibliothek::kb_settings::refresh }
    }

    # Nach jedem Espresso: kurz warten, bis Gewicht und Zeit feststehen; die Historie danach, wenn die App ihre Dateien geschrieben hat
    proc on_flow_complete { event_dict } {
        if { [dict get $event_dict previous_state] eq "Espresso" } {
            after [ms wait_s] [list ::plugins::kaffeebibliothek::collect 0]
            after [ms history_after_shot_s] ::plugins::kaffeebibliothek::sync_history
        }
    }

    # force = 1: ohne Mindestdauer (Knopf "Letzten Shot senden")
    proc collect { {force 0} } {
        variable settings
        variable pending
        variable attempt

        if { [string trim [ifexists settings(url)]] eq "" } {
            status [translate "Keine Adresse eingetragen"]
            return
        }
        if { [espresso_elapsed length] < 2 } {
            status [translate "Kein Shot vorhanden"]
            return
        }
        set seconds [espresso_elapsed range end end]
        set min [num min_seconds]
        if { !$force && $seconds < $min } {
            status "Nicht gesendet: kürzer als $min s"
            return
        }
        set bev [ifexists ::settings(beverage_type) espresso]
        if { !$force && $bev in [ifexists settings(skip_types)] } {
            status "Nicht gesendet: $bev"
            return
        }
        if { [catch { set pending [encoding convertto utf-8 [::shot::create]] } err] } {
            status "Fehler beim Erstellen: $err"
            return
        }
        set settings(last_shot) [ifexists ::settings(espresso_clock)]
        set attempt 0
        send
    }

    proc url { {route shots} } {
        variable settings
        return "[string trimright [string trim $settings(url)] /]/api/decent/$route"
    }

    proc use_tls { url } {
        if { [regexp -nocase {^https://([^/:]+)} $url -> host] } {
            catch { ::http::register https 443 [list ::tls::socket -servername $host] }
        }
    }

    proc send {} {
        variable pending
        variable attempt
        incr attempt
        set url [url]
        use_tls $url
        if { [catch {
            ::http::geturl $url -method POST -type "application/json; charset=utf-8" -query $pending -timeout [ms timeout_s] \
                -command ::plugins::kaffeebibliothek::done
        } err] } {
            retry $err
        }
    }

    proc done { token } {
        variable pending
        set state [::http::status $token]
        set code [::http::ncode $token]
        set body [::http::data $token]
        ::http::cleanup $token
        if { $state eq "ok" && $code >= 200 && $code < 300 } {
            set pending {}
            status "Gesendet um [clock format [clock seconds] -format %H:%M]"
            catch { popup [translate_toast "An Kaffeebibliothek gesendet"] }
        } elseif { $state eq "ok" && $code >= 400 && $code < 500 } {
            set pending {}
            status "Abgelehnt ($code): [string range $body 0 160]"
        } else {
            retry "$state $code"
        }
    }

    # Mehrere Versuche mit wachsender Pause (WLAN nach dem Aufwachen, Server-Neustart)
    proc retry { why } {
        variable attempt
        variable pending
        msg "Senden fehlgeschlagen ($attempt): $why"
        if { $attempt < [num retries] } {
            after [expr { $attempt * [ms retry_pause_s] }] ::plugins::kaffeebibliothek::send
            return
        }
        set pending {}
        status "Nicht erreichbar: $why"
        catch { popup [translate_toast "Kaffeebibliothek nicht erreichbar"] }
    }

    # ---------- Historie ----------

    # Datenordner der App (neuere de1app: data_directory, ältere: homedir)
    proc datadir {} {
        if { [info commands ::data_directory] ne "" } { return [::data_directory] }
        return [homedir]
    }

    proc sentfile {} {
        if { [info commands ::plugin_settings_file] ne "" } {
            return [file join [file dirname [::plugin_settings_file kaffeebibliothek]] sent.txt]
        }
        return [file join [homedir] plugins kaffeebibliothek sent.txt]
    }

    proc load_sent {} {
        variable sent
        variable sent_loaded
        if { $sent_loaded } return
        set sent_loaded 1
        if { ![file exists [sentfile]] } return
        if { [catch {
            set fh [open [sentfile] r]
            fconfigure $fh -encoding utf-8
            while { [gets $fh line] >= 0 } {
                if { [llength $line] == 3 } { set sent([lindex $line 0]) [lrange $line 1 2] }
            }
            close $fh
        } err] } {
            msg "sent.txt nicht gelesen: $err"
        }
    }

    proc remember { path stamp } {
        variable sent
        set sent($path) $stamp
        catch {
            set fh [open [sentfile] a]
            fconfigure $fh -encoding utf-8
            puts $fh [list $path {*}$stamp]
            close $fh
        }
    }

    proc hstatus { text } {
        variable settings
        set settings(history_result) $text
        save
    }

    # Meldung unten am Bildschirm (Android-Toast der de1app), abschaltbar mit toast_every 0
    proc toast { text } {
        if { [num toast_every] > 0 } { catch { popup "Kaffeebibliothek: $text" } }
    }

    # Neue und geänderte Dateien suchen; neue Shots zuerst im JSON-Format, das Altformat danach
    # quick = 1: nur die eigenen Profile der App (profiles/_*.tcl), ohne Meldung
    proc sync_history { {quick 0} } {
        variable settings
        variable queue
        variable busy
        variable done_n
        variable failed_n
        variable total_n
        variable sent
        variable quiet
        if { $busy } return
        if { [string trim [ifexists settings(url)]] eq "" } return
        if { !$quick && [string trim [ifexists settings(history_dirs)]] eq "" } {
            hstatus "Aus (keine Ordner eingetragen)"
            return
        }
        load_sent
        set base [datadir]
        set queue {}
        variable PATTERNS
        set dirs [expr { $quick ? {profiles} : [ifexists settings(history_dirs)] }]
        foreach dir $dirs {
            if { ![dict exists $PATTERNS $dir] } continue
            set pattern [expr { $quick ? {_*.tcl} : [dict get $PATTERNS $dir] }]
            foreach f [lsort -dictionary -decreasing [glob -nocomplain -tails -directory [file join $base $dir] $pattern]] {
                set full [file join $base $dir $f]
                if { [catch { set stamp [list [file mtime $full] [file size $full]] }] } continue
                set path "$dir/$f"
                if { [info exists sent($path)] && $sent($path) eq $stamp } continue
                lappend queue [list $path $full $stamp]
            }
        }
        set total_n [llength $queue]
        set done_n 0
        set failed_n 0
        if { !$total_n } {
            if { !$quick } { hstatus "Vollständig ([array size sent] Dateien)" }
            return
        }
        set busy 1
        set quiet $quick
        if { !$quick } {
            hstatus "Sende 0 von $total_n"
            toast "sende $total_n Dateien"
        }
        next_file
    }

    proc next_file {} {
        variable queue
        variable busy
        variable done_n
        variable failed_n
        variable total_n
        variable settings
        variable quiet
        if { ![llength $queue] } {
            set busy 0
            if { $quiet } {
                pstatus "$total_n am Tablet geändert, gesendet um [clock format [clock seconds] -format %H:%M:%S]"
            } elseif { $failed_n } {
                hstatus "Gesendet [expr { $done_n - $failed_n }] von $total_n, $failed_n abgelehnt"
                toast "[expr { $done_n - $failed_n }] von $total_n gesendet, $failed_n abgelehnt"
            } else {
                hstatus "Vollständig, $total_n neu um [clock format [clock seconds] -format %H:%M]"
                toast "alle $total_n gesendet"
            }
            return
        }
        lassign [lindex $queue 0] path full stamp
        if { [catch {
            set fh [open $full rb]
            set data [read $fh]
            close $fh
        } err] } {
            # verschwunden oder gesperrt: überspringen, beim nächsten Mal wieder versuchen
            set queue [lrange $queue 1 end]
            incr done_n
            incr failed_n
            after 10 ::plugins::kaffeebibliothek::next_file
            return
        }
        set url "[url files]?[::http::formatQuery path $path mtime [lindex $stamp 0] min_seconds [num min_seconds] skip_types [ifexists settings(skip_types)]]"
        use_tls $url
        if { [catch {
            ::http::geturl $url -method POST -type "application/octet-stream" -query $data -timeout [ms timeout_s] \
                -command ::plugins::kaffeebibliothek::file_done
        } err] } {
            stop_history $err
        }
    }

    proc file_done { token } {
        variable queue
        variable done_n
        variable failed_n
        variable total_n
        set state [::http::status $token]
        set code [::http::ncode $token]
        set body [::http::data $token]
        ::http::cleanup $token
        lassign [lindex $queue 0] path full stamp
        if { $state eq "ok" && $code >= 200 && $code < 300 } {
            remember $path $stamp
        } elseif { $state eq "ok" && $code >= 400 && $code < 500 } {
            # kaputte Datei: nicht jedes Mal wieder schicken
            remember $path $stamp
            incr failed_n
            msg "Abgelehnt: $path ($code) [string range $body 0 160]"
        } else {
            stop_history "$state $code"
            return
        }
        set queue [lrange $queue 1 end]
        incr done_n
        if { $done_n % 10 == 0 } { hstatus "Sende $done_n von $total_n" }
        set every [expr { int([num toast_every]) }]
        if { $every > 0 && $done_n % $every == 0 && $done_n < $total_n } { toast "$done_n von $total_n gesendet" }
        after 20 ::plugins::kaffeebibliothek::next_file
    }

    # Server weg: aufhören und später neu ansetzen (Gesendetes bleibt gesendet)
    proc stop_history { why } {
        variable busy
        variable done_n
        variable total_n
        variable quiet
        set busy 0
        # schneller Abgleich: still, der nächste läuft ohnehin in ein paar Sekunden
        if { $quiet } {
            pstatus "Nicht gesendet ($why)"
            return
        }
        msg "Historie unterbrochen: $why"
        hstatus "Unterbrochen bei $done_n von $total_n ($why), neuer Versuch in [num history_retry_min] min"
        toast "unterbrochen bei $done_n von $total_n ($why)"
        after [expr { int([num history_retry_min] * 60000) }] ::plugins::kaffeebibliothek::sync_history
    }

    # ---------- Profile der Kaffees ----------

    proc pstatus { text } {
        variable settings
        set settings(profile_result) $text
        save
    }

    # full = 1: alle Profile (auch wenn am Tablet eins gelöscht wurde), sonst nur ab dem bekannten Stand
    proc sync_profiles { {full 0} } {
        variable settings
        variable pulling
        variable pstand
        if { $pulling || [string trim [ifexists settings(url)]] eq "" } return
        set pulling 1
        set url "[url profiles]?[::http::formatQuery since [expr { $full ? 0 : $pstand }]]"
        use_tls $url
        if { [catch { ::http::geturl $url -binary 1 -timeout [ms timeout_s] -command ::plugins::kaffeebibliothek::profiles_done } err] } {
            set pulling 0
            pstatus "Nicht erreichbar: $err"
        }
    }

    proc profiles_done { token } {
        variable pulling
        variable pstand
        set pulling 0
        set state [::http::status $token]
        set code [::http::ncode $token]
        set body [::http::data $token]
        ::http::cleanup $token
        if { $state ne "ok" || $code < 200 || $code >= 300 } {
            pstatus "Nicht geholt ($state $code)"
            return
        }
        if { [catch { set items [encoding convertfrom utf-8 $body]; llength $items } err] } {
            pstatus "Antwort unlesbar: $err"
            return
        }
        load_sent
        set dir [file join [datadir] profiles]
        set changed {}
        foreach item $items {
            if { [llength $item] != 3 } continue
            lassign $item fn stamp content
            # nur Dateien der App: beginnen mit _, ohne Pfad
            if { ![string match {_*} $fn] || [regexp {[/\\]} $fn] || ![string is integer -strict $stamp] } continue
            if { $stamp > $pstand && $stamp <= [clock seconds] + 60 } { set pstand $stamp }
            set f [file join $dir "$fn.tcl"]
            if { [file exists $f] && [file mtime $f] >= $stamp } continue
            if { [catch {
                set fh [open $f w]
                fconfigure $fh -encoding utf-8 -translation lf
                puts -nonewline $fh $content
                close $fh
            } err] } {
                msg "Profil $fn nicht geschrieben: $err"
                continue
            }
            catch { file mtime $f $stamp }
            # nicht als Änderung zurückschicken
            remember "profiles/$fn.tcl" [list [file mtime $f] [file size $f]]
            lappend changed $fn
        }
        set n [llength $changed]
        if { !$n } {
            if { [llength $items] > 1 } { pstatus "Aktuell ([llength $items] Profile) um [clock format [clock seconds] -format %H:%M]" }
            return
        }
        catch { fill_profiles_listbox }
        # gerade gewähltes Profil neu laden, wenn die Maschine nichts tut
        if { [ifexists ::settings(profile_filename)] in $changed } {
            catch { if { $::de1_num_state($::de1(state)) in {Idle Sleep} } { select_profile $::settings(profile_filename) } }
        }
        pstatus "$n neu oder geändert um [clock format [clock seconds] -format %H:%M:%S]"
        toast "$n Profile aktualisiert"
    }

    # Alle paar Minuten: ganze Historie hoch, alle Profile der App herunter
    proc tick {} {
        after cancel ::plugins::kaffeebibliothek::tick
        sync_history
        sync_profiles 1
        set m [num history_sync_min]
        if { $m > 0 } { after [expr { int($m * 60000) }] ::plugins::kaffeebibliothek::tick }
    }

    # Alle paar Sekunden: nur geänderte Profile in beide Richtungen; während eines Bezugs, Dampf oder Heißwasser nicht
    proc quick {} {
        after cancel ::plugins::kaffeebibliothek::quick
        set s [num profile_sync_s]
        if { $s <= 0 } return
        set busy_machine 0
        catch { set busy_machine [expr { $::de1_num_state($::de1(state)) in {Espresso Steam HotWater HotWaterRinse} }] }
        if { !$busy_machine } {
            sync_history 1
            sync_profiles
        }
        after [expr { int(max($s, 2) * 1000) }] ::plugins::kaffeebibliothek::quick
    }

    proc create_ui {} {
        dui page add kb_settings -namespace ::plugins::kaffeebibliothek::kb_settings -bg_img settings_message.png -type fpdialog
        return "kb_settings"
    }

    proc main {} {
        variable settings
        variable DEFAULTS
        foreach {k v} [concat $DEFAULTS {last_result {} last_shot {} history_result {} profile_result {}}] {
            if { ![info exists settings($k)] } { set settings($k) $v }
        }
        save
        plugins gui kaffeebibliothek [create_ui]
        ::de1::event::listener::after_flow_complete_add \
            [lambda {event_dict} { ::plugins::kaffeebibliothek::on_flow_complete $event_dict }]
        # Historie und Profile nach dem Start, wenn WLAN und App bereit sind
        after [ms history_start_s] ::plugins::kaffeebibliothek::tick
        after [expr { [ms history_start_s] + 5000 }] ::plugins::kaffeebibliothek::quick
    }
}

namespace eval ::plugins::kaffeebibliothek::kb_settings {
    variable widgets
    array set widgets {}
    variable data
    array set data {}

    proc setup {} {
        variable widgets
        set page_name [namespace tail [namespace current]]

        dui add dtext $page_name 1280 300 -text "Kaffeebibliothek" -font Helv_20_bold -width 1200 -fill "#444444" -anchor center -justify center

        # links: Adresse und Zahlen, rechts: Stand und Listen
        field $page_name url 280 480 40 "Adresse der Kaffeebibliothek"
        field $page_name min_seconds 280 660 5 "Mindestdauer s"
        field $page_name wait_s 680 660 5 "Warten nach Shot s"
        field $page_name timeout_s 1080 660 5 "Zeitlimit s"
        field $page_name retries 280 840 5 "Versuche"
        field $page_name retry_pause_s 680 840 5 "Pause s (wächst)"
        field $page_name history_retry_min 1080 840 5 "Historie erneut min"
        field $page_name history_start_s 280 1020 5 "Historie nach Start s"
        field $page_name history_after_shot_s 680 1020 5 "Historie nach Shot s"
        field $page_name toast_every 1080 1020 5 "Meldung alle N (0 = aus)"

        field $page_name history_dirs 1500 480 28 "Ordner der Historie (leer = aus)"
        field $page_name skip_types 1500 660 28 "Nicht senden (Getränkearten)"

        field $page_name profile_sync_s 1500 840 5 "Profile alle s (0 = aus)"
        field $page_name history_sync_min 1900 840 5 "Alles alle min (0 = aus)"

        foreach {key y label} {last_result 1000 "Shot:" history_result 1055 "Historie:" profile_result 1110 "Profile:"} {
            dui add dtext $page_name 1500 $y -text $label -font Helv_8 -width 200 -fill "#444444" -anchor nw
            dui add variable $page_name 1720 $y -tags $key -font Helv_8 -width 800 -fill "#4e85f4" -anchor nw -justify left \
                -textvariable ::plugins::kaffeebibliothek::settings($key)
        }

        # Befehle wie bei Done über den Tag (send_last, send_history in diesem Namensraum); feste Farbe, damit nichts grau wirkt
        foreach {tag x label} {send_last 280 "Letzten Shot senden" send_history 1680 "Abgleichen"} {
            dui add dbutton $page_name $x 1210 [expr { $x + 600 }] 1410 -tags $tag -shape round -radius 30 -tap_pad 20 \
                -fill "#4e85f4" -disabledfill "#4e85f4" -outline "#4e85f4" \
                -label $label -label_font Helv_8_bold -label_fill white -label_disabledfill white -label_pos {0.5 0.5}
        }

        dui add dbutton $page_name 980 1210 1580 1410 -tags page_done -label [translate "Done"] -label_pos {0.5 0.5} \
            -label_font Helv_10_bold -label_fill "#fAfBff"
    }

    # Eingabefeld mit Beschriftung darüber, Enter speichert
    proc field { page key x y width label } {
        variable widgets
        dui add entry $page $x [expr { $y + 60 }] -tags $key -width $width -font Helv_8 -borderwidth 1 -bg #fbfaff -foreground #4e85f4 \
            -textvariable ::plugins::kaffeebibliothek::settings($key) -relief flat -highlightthickness 1 -highlightcolor #000000 \
            -label $label -label_pos [list $x $y] -label_font Helv_8 -label_width 380 -label_fill "#444444"
        bind $widgets($key) <Return> [namespace current]::save_settings
    }

    proc refresh {} {}

    proc send_last {} {
        dui say [translate {Sending}] sound_button_in
        ::plugins::kaffeebibliothek::status "Sende letzten Shot …"
        ::plugins::kaffeebibliothek::collect 1
    }

    # Läuft schon eine Übertragung: Stand zeigen statt still nichts zu tun
    proc send_history {} {
        dui say [translate {Sending}] sound_button_in
        if { $::plugins::kaffeebibliothek::busy } {
            ::plugins::kaffeebibliothek::hstatus \
                "Läuft schon: $::plugins::kaffeebibliothek::done_n von $::plugins::kaffeebibliothek::total_n"
            ::plugins::kaffeebibliothek::sync_profiles
            return
        }
        ::plugins::kaffeebibliothek::hstatus "Suche Dateien …"
        ::plugins::kaffeebibliothek::pstatus "Hole Profile …"
        after 50 ::plugins::kaffeebibliothek::tick
    }

    proc save_settings {} {
        dui say [translate {Saved}] sound_button_in
        ::plugins::kaffeebibliothek::save
    }

    proc page_done {} {
        dui say [translate {Done}] sound_button_in
        ::plugins::kaffeebibliothek::save
        dui page close_dialog
    }
}
