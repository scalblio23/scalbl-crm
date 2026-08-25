// Real client data imported from the team's client-list CSV/screenshot.
// Used by importClientData() in db.js to (re)populate the clients and
// client_columns tables — see the Clients page's Import button.
export const CLIENT_COLUMNS = [
  {
    "key": "rep_name",
    "label": "Ad Name",
    "type": "text"
  },
  {
    "key": "rank",
    "label": "Rank",
    "type": "number"
  },
  {
    "key": "cpl_4day",
    "label": "4 Day CPL",
    "type": "currency"
  },
  {
    "key": "booking_avg_4day",
    "label": "4 Day Booking Avg",
    "type": "currency"
  },
  {
    "key": "booking_count_4day",
    "label": "4 Day Booking Count",
    "type": "number"
  },
  {
    "key": "lead_count_4day",
    "label": "4 Day Lead Count",
    "type": "number"
  },
  {
    "key": "spend_4day",
    "label": "4 Day Spend",
    "type": "currency"
  },
  {
    "key": "ad_account_link",
    "label": "Ad Account Link",
    "type": "url"
  },
  {
    "key": "ad_account_status",
    "label": "Ad Account Status",
    "type": "select",
    "options": [
      {
        "value": "Live",
        "color": "green"
      },
      {
        "value": "Not Live",
        "color": "red"
      }
    ]
  },
  {
    "key": "ad_comments",
    "label": "Ad Comments",
    "type": "long_text"
  },
  {
    "key": "ad_status",
    "label": "Ad Status",
    "type": "select",
    "options": [
      {
        "value": "Live",
        "color": "green"
      },
      {
        "value": "Not Live",
        "color": "red"
      },
      {
        "value": "N/A",
        "color": "gray"
      }
    ]
  },
  {
    "key": "booking_comment",
    "label": "Booking Comment",
    "type": "long_text"
  },
  {
    "key": "booking_link",
    "label": "Booking Link",
    "type": "url"
  },
  {
    "key": "call_type",
    "label": "Call Type",
    "type": "text"
  },
  {
    "key": "campaign_doc",
    "label": "Campaign Doc",
    "type": "text"
  },
  {
    "key": "client_type",
    "label": "Client Type",
    "type": "select",
    "options": [
      {
        "value": "Not Applicable",
        "color": "gray"
      },
      {
        "value": "Primary - 40-50 mins",
        "color": "green"
      },
      {
        "value": "Secondary - 25-30 Mins",
        "color": "amber"
      },
      {
        "value": "Low Tier - 15 to 20 mins",
        "color": "blue"
      }
    ]
  },
  {
    "key": "date_of_payment",
    "label": "Date Of Payment",
    "type": "date"
  },
  {
    "key": "henry_comment",
    "label": "Henry Comment",
    "type": "long_text"
  },
  {
    "key": "henry_to_do",
    "label": "Henry To Do",
    "type": "long_text"
  },
  {
    "key": "last_message_csm",
    "label": "Last Message CSM",
    "type": "text"
  },
  {
    "key": "mrr",
    "label": "MRR",
    "type": "currency"
  },
  {
    "key": "next_7_days_appt_kpi",
    "label": "Next 7 Days - Appt KPI",
    "type": "number"
  },
  {
    "key": "page",
    "label": "Page",
    "type": "text"
  },
  {
    "key": "paid_july",
    "label": "Paid (July)",
    "type": "checkbox"
  },
  {
    "key": "priority",
    "label": "Priority",
    "type": "select",
    "options": [
      {
        "value": "High",
        "color": "red"
      },
      {
        "value": "Medium",
        "color": "amber"
      },
      {
        "value": "Low",
        "color": "gray"
      }
    ]
  },
  {
    "key": "setting_comments_today",
    "label": "Setting Comments For Today",
    "type": "long_text"
  },
  {
    "key": "special_ad_account_rules",
    "label": "Special Ad Account Rules",
    "type": "long_text"
  },
  {
    "key": "summary",
    "label": "Summary",
    "type": "long_text"
  },
  {
    "key": "target_cpl",
    "label": "Target CPL",
    "type": "currency"
  },
  {
    "key": "task",
    "label": "Task",
    "type": "text"
  },
  {
    "key": "team_notes",
    "label": "Team Notes",
    "type": "long_text"
  },
  {
    "key": "text_field",
    "label": "Text",
    "type": "text"
  },
  {
    "key": "the_script",
    "label": "The Script",
    "type": "text"
  },
  {
    "key": "to_do",
    "label": "To Do",
    "type": "long_text"
  },
  {
    "key": "weekly_report",
    "label": "Weekly Report",
    "type": "long_text"
  }
];

export const IMPORTED_CLIENTS = [
  {
    "name": "Clicksmith Pro",
    "fields": {
      "rep_name": "Mike/Michael",
      "rank": 16,
      "cpl_4day": 2.35,
      "lead_count_4day": 92,
      "spend_4day": 216.26,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=718995589957678&business_id=718995589957678&act=1572526987755616&redirect_session_id=8530a202-eb40-43b0-b9b0-bd0ac6f1ebbe#",
      "ad_account_status": "Live",
      "ad_status": "Not Live",
      "client_type": "Not Applicable",
      "date_of_payment": "2026-07-30",
      "henry_comment": "-",
      "last_message_csm": "28th July",
      "mrr": 1000,
      "next_7_days_appt_kpi": 0,
      "paid_july": false,
      "special_ad_account_rules": "• In ad account called: Clicksmith Pro",
      "weekly_report": "Total Leads: 62 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Wilco Relining",
    "fields": {
      "rep_name": "Pascal",
      "rank": 18,
      "cpl_4day": 83.63,
      "booking_avg_4day": 1.75,
      "booking_count_4day": 7,
      "lead_count_4day": 9,
      "spend_4day": 752.68,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1053258310017552&business_id=718995589957678&global_scope_id=718995589957678",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "8 -  Pascal (https://app.notion.com/p/8-Pascal-3bb24f67814f801e8056ddce23cd0e05?pvs=21)",
      "client_type": "Primary - 40-50 mins",
      "date_of_payment": "2026-07-14",
      "henry_comment": "Next week: \n15 Calls",
      "mrr": 2600,
      "next_7_days_appt_kpi": 12,
      "paid_july": false,
      "setting_comments_today": "Our hit rate is like 3 / 20 which is awful.",
      "special_ad_account_rules": "• In ad account Wilco Relining with “S.IO” in naming convention",
      "target_cpl": 50,
      "team_notes": "[1] Send jimmy creatives - Henry\n\n[2] New campaign",
      "text_field": "40 mins",
      "weekly_report": "Total Leads: 27 - 31/7\nTotal Bookings: 9\nMonthly Avg: 108 (leads), 36 (bookings)"
    }
  },
  {
    "name": "Sandford Electrica",
    "fields": {
      "rep_name": "Dylan",
      "rank": 9,
      "cpl_4day": 110.19,
      "booking_avg_4day": 1.25,
      "booking_count_4day": 5,
      "lead_count_4day": 7,
      "spend_4day": 771.35,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1554206692783434&business_id=4224681034275407&nav_entry_point=ads_ecosystem_navigation_menu&date=2026-06-29_2026-07-06&comparison_date=&insights_date=2026-06-29_2026-07-06&insights_comparison_date=&nav_source=ads_manager",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "12 - Dylan (https://app.notion.com/p/12-Dylan-3bb24f67814f80d5aaf2eaf36c5bdf6a?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-11",
      "henry_comment": "Next Week:\n20 ledas\n10 bookings",
      "last_message_csm": "28th July",
      "mrr": 1500,
      "next_7_days_appt_kpi": 10,
      "paid_july": true,
      "setting_comments_today": "We need 2 bookings today",
      "special_ad_account_rules": "• In ad account called sandford\n  • Just simply labelled S.IO",
      "target_cpl": 50,
      "text_field": "30 mins",
      "weekly_report": "Total Leads: 17 - 31/7\nTotal Bookings: 6"
    }
  },
  {
    "name": "Goal Finance",
    "fields": {
      "rep_name": "Luke",
      "rank": 14,
      "cpl_4day": 25.92,
      "lead_count_4day": 14,
      "spend_4day": 362.83,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=718995589957678&business_id=718995589957678&act=1424804918570597&redirect_session_id=cfc6a0da-0828-4a0a-ac18-f8f865d4f655#",
      "ad_account_status": "Live",
      "ad_status": "Not Live",
      "campaign_doc": "16 - Luke (https://app.notion.com/p/16-Luke-3bb24f67814f80a19b4dc14ac4be55ba?pvs=21)",
      "client_type": "Low Tier - 15 to 20 mins",
      "henry_comment": "Next week:\n20 leads\n5 calls",
      "last_message_csm": "27th July",
      "mrr": 0,
      "paid_july": false,
      "special_ad_account_rules": "• Goal Finance",
      "target_cpl": 30,
      "task": "Get his ads live (1/2 session) (https://app.notion.com/p/Get-his-ads-live-1-2-session-3a924f67814f8053b2def9df2c103519?pvs=21)",
      "weekly_report": "Total Leads: 7 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Khan Legal",
    "fields": {
      "rep_name": "Imran",
      "rank": 12,
      "cpl_4day": 24.7,
      "booking_avg_4day": 1,
      "booking_count_4day": 4,
      "lead_count_4day": 9,
      "spend_4day": 222.29,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=889934823992615&business_id=718995589957678&global_scope_id=718995589957678&date=2025-12-03_2026-07-09%2Cmaximum&comparison_date=&insights_date=2025-12-03_2026-07-09%2Cmaximum&insights_comparison_date=",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "13- Imran (https://app.notion.com/p/13-Imran-3bb24f67814f8066a4a3ca6b76ce082b?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-10",
      "henry_comment": "Next week:\n5-10 bookings\n20 leads",
      "last_message_csm": "28th July",
      "mrr": 1200,
      "next_7_days_appt_kpi": 7,
      "paid_july": true,
      "special_ad_account_rules": "• In ad account http://S.IO #1",
      "target_cpl": 20,
      "task": "Imran New Creative (https://app.notion.com/p/Imran-New-Creative-3a624f67814f80c1a553eeed94e63fa8?pvs=21)",
      "text_field": "20 mins",
      "weekly_report": "Total Leads: 17 - 31/7\nTotal Bookings: 7"
    }
  },
  {
    "name": "Prestige Cleaining",
    "fields": {
      "rep_name": "Suleiman",
      "lead_count_4day": 0,
      "spend_4day": 0,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1554893616263411&business_id=718995589957678&global_scope_id=718995589957678&columns=name%2Cdelivery%2Crecommendations_guidance%2Cresults%2Ccost_per_result%2Cbudget%2Cspend%2Cimpressions%2Creach%2Cfrequency%2Ccpm%2Cactions%3Alink_click%2Cschedule%2Cend_time%2Cattribution_setting%2Cbid%2Clast_significant_edit%2Cquality_score_organic%2Cquality_score_ectr%2Cquality_score_ecvr%2Ccampaign_name&attribution_windows=default",
      "ad_account_status": "Not Live",
      "ad_status": "Not Live",
      "booking_comment": "28/7 - 0\n29/7 - 0\n30/7 - 0\n31/7 - 0",
      "client_type": "Not Applicable",
      "date_of_payment": "2026-07-15",
      "henry_comment": "-",
      "mrr": 1000,
      "next_7_days_appt_kpi": 10,
      "paid_july": true,
      "task": "Get his ads live - Session (https://app.notion.com/p/Get-his-ads-live-Session-3a924f67814f802badaac421fc20c7d3?pvs=21)",
      "weekly_report": "Total Leads: 0 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Moje Financial",
    "fields": {
      "rep_name": "Adrian",
      "rank": 1,
      "cpl_4day": 202.14,
      "booking_avg_4day": 0.25,
      "booking_count_4day": 1,
      "lead_count_4day": 1,
      "spend_4day": 202.14,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1554206692783434&business_id=4224681034275407&nav_entry_point=ads_ecosystem_navigation_menu&date=2026-06-29_2026-07-06&comparison_date=&insights_date=2026-06-29_2026-07-06&insights_comparison_date=&nav_source=ads_manager",
      "ad_account_status": "Not Live",
      "ad_status": "Not Live",
      "campaign_doc": "15 - Adrian (https://app.notion.com/p/15-Adrian-3bb24f67814f80d2bb11d30e0238af37?pvs=21)",
      "client_type": "Low Tier - 15 to 20 mins",
      "date_of_payment": "2026-07-31",
      "henry_comment": "Next week:\n10 leads\n5 bookings",
      "mrr": 1170,
      "next_7_days_appt_kpi": 6,
      "page": "Fincheck",
      "paid_july": false,
      "special_ad_account_rules": "• He is in sanford account\n  • His campaign is labelled “Moje”",
      "target_cpl": 30,
      "task": "Get Ads live session (https://app.notion.com/p/Get-Ads-live-session-3a924f67814f80e68fddf0e256187b32?pvs=21)",
      "text_field": "15 mins",
      "weekly_report": "Total Leads: 1 - 31/7\nTotal Bookings: 3"
    }
  },
  {
    "name": "Fundd",
    "fields": {
      "rep_name": "Christian",
      "rank": 8,
      "cpl_4day": 47.38,
      "booking_avg_4day": 0.25,
      "booking_count_4day": 1,
      "lead_count_4day": 3,
      "spend_4day": 142.15,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1434876818528338&business_id=718995589957678&nav_entry_point=fbs_ad_account_open_in_ads_manager_button&date=2026-06-17_2026-08-04%2Cmaximum&insights_date=2026-06-17_2026-08-04%2Cmaximum&nav_source=facebook_business_suite",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "3 - Christian (https://app.notion.com/p/3-Christian-3bb24f67814f8000b68be89bf10a237b?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-22",
      "henry_comment": "Next week:\n10 leads\n5 Bookings",
      "last_message_csm": "28th July",
      "mrr": 1500,
      "next_7_days_appt_kpi": 7,
      "page": "Fincheck",
      "paid_july": true,
      "special_ad_account_rules": "• In ad account called Fundd - New",
      "target_cpl": 30,
      "task": "Add payment to ad account - account S.IO #5 (https://app.notion.com/p/Add-payment-to-ad-account-account-S-IO-5-3a924f67814f80c69096d4e4a2d8757c?pvs=21)",
      "text_field": "(15 mins)",
      "weekly_report": "Total Leads: 0 - 31/7\nTotal Bookings: 1"
    }
  },
  {
    "name": "Cable Co",
    "fields": {
      "rep_name": "Brendon",
      "rank": 6,
      "cpl_4day": 77.66,
      "booking_avg_4day": 1,
      "booking_count_4day": 4,
      "lead_count_4day": 4,
      "spend_4day": 310.65,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1407003067618851&business_id=718995589957678&nav_entry_point=ads_ecosystem_navigation_menu&nav_source=ads_manager",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "9 - Brendon (https://app.notion.com/p/9-Brendon-3bb24f67814f803ab48dc4e41b702ca8?pvs=21)",
      "client_type": "Primary - 40-50 mins",
      "date_of_payment": "2026-07-03",
      "henry_comment": "Next Week:\n25 leads\n10 bookings",
      "last_message_csm": "28th July",
      "mrr": 1700,
      "next_7_days_appt_kpi": 10,
      "paid_july": true,
      "special_ad_account_rules": "• In ad account, Cable Co New",
      "target_cpl": 25,
      "task": "Get ads live session (https://app.notion.com/p/Get-ads-live-session-3a924f67814f801ea441d98d26700a3d?pvs=21)",
      "text_field": "20 mins",
      "weekly_report": "Total Leads: 14 - 31/7\nTotal Bookings: 3"
    }
  },
  {
    "name": "Nexa Home Solution",
    "fields": {
      "rep_name": "Ameen",
      "rank": 3,
      "cpl_4day": 40.33,
      "booking_avg_4day": 0.5,
      "booking_count_4day": 2,
      "lead_count_4day": 5,
      "spend_4day": 201.64,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=718995589957678&business_id=718995589957678&act=1521208299492090&redirect_session_id=fbb467ff-5800-4827-80ba-940a77bb9947#",
      "ad_account_status": "Live",
      "ad_status": "Live",
      "campaign_doc": "4- Ameen (https://app.notion.com/p/4-Ameen-3bb24f67814f80b3a7b5d7071206c10c?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-22",
      "henry_comment": "Next Week:\n25 leads (push spend)\n7 bookings",
      "last_message_csm": "28th July",
      "mrr": 1700,
      "next_7_days_appt_kpi": 10,
      "paid_july": true,
      "special_ad_account_rules": "• In ad account called http://S.ioIO - #1",
      "target_cpl": 25,
      "task": "Setting Assets (https://app.notion.com/p/Setting-Assets-3a924f67814f80ed83a9e6f2c9696a89?pvs=21), Integration Session (https://app.notion.com/p/Integration-Session-3a924f67814f803ab9c1dfccae18a775?pvs=21), Script (https://app.notion.com/p/Script-3a924f67814f8044a891eac1eae33721?pvs=21)",
      "text_field": "30 mins",
      "weekly_report": "Total Leads: 18 - 31/7\nTotal Bookings: 3"
    }
  },
  {
    "name": "Haute Kitchen",
    "fields": {
      "rep_name": "Mohammed",
      "rank": 17,
      "booking_avg_4day": 0.25,
      "booking_count_4day": 1,
      "lead_count_4day": 0,
      "spend_4day": 0,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/ads?act=603124960882754&business_id=718995589957678&global_scope_id=718995589957678&nav_entry_point=am_global_scope_selector&selected_campaign_ids=120249592274310052",
      "ad_account_status": "Not Live",
      "ad_status": "Not Live",
      "campaign_doc": "14 - Mohammed (https://app.notion.com/p/14-Mohammed-3bb24f67814f804585bbdc9b08a7d362?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-02",
      "henry_comment": "Next Week:\n10 calls",
      "last_message_csm": "28th July",
      "mrr": 1500,
      "next_7_days_appt_kpi": 7,
      "paid_july": true,
      "special_ad_account_rules": "• In ad account Haute Kitchen #2",
      "target_cpl": 30,
      "text_field": "20 mins",
      "weekly_report": "Total Leads: 10 - 31/7\nTotal Bookings: 4"
    }
  },
  {
    "name": "Solar Battery Rebate",
    "fields": {
      "rep_name": "Ryan - SBR",
      "rank": 21,
      "cpl_4day": 15.35,
      "lead_count_4day": 9,
      "spend_4day": 138.13,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=718995589957678&business_id=718995589957678&act=698402602533485&redirect_session_id=e14e6a0f-8a2a-456c-944c-e162a71198d4#",
      "ad_account_status": "Not Live",
      "ad_status": "Live",
      "campaign_doc": "2 - Ryan (https://app.notion.com/p/2-Ryan-3bb24f67814f809db1c3e79f45c94d59?pvs=21)",
      "client_type": "Primary - 40-50 mins",
      "date_of_payment": "2026-07-22",
      "henry_comment": "Next Week: \n15 calls",
      "last_message_csm": "28th July",
      "mrr": 1980,
      "next_7_days_appt_kpi": 12,
      "page": "Solarcheck",
      "paid_july": true,
      "special_ad_account_rules": "• In ad account Solar Rebate",
      "target_cpl": 15,
      "task": "Integration Session (Automations + Sheets) (https://app.notion.com/p/Integration-Session-Automations-Sheets-3a924f67814f80cba5edd2bc928cb623?pvs=21), Get Ads live session (https://app.notion.com/p/Get-Ads-live-session-3a924f67814f80ca943fdcb52e1125ca?pvs=21)",
      "text_field": "15 mins",
      "weekly_report": "Total Leads: 29 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Settla",
    "fields": {
      "rep_name": "Elias",
      "rank": 10,
      "booking_avg_4day": 0.75,
      "booking_count_4day": 3,
      "ad_account_link": "N/A",
      "ad_status": "N/A",
      "campaign_doc": "17 - Elias (https://app.notion.com/p/17-Elias-3bb24f67814f80d0a0c3d566ffd2d01e?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-23",
      "henry_comment": "Next week:\n10 bookings",
      "last_message_csm": "28th July",
      "mrr": 1250,
      "next_7_days_appt_kpi": 10,
      "paid_july": false,
      "special_ad_account_rules": "No ad account",
      "text_field": "30 mins (2 minimum)",
      "weekly_report": "Total Leads: N/A - 31/7\nTotal Bookings: 5"
    }
  },
  {
    "name": "Loncini + Zarelli",
    "fields": {
      "rep_name": "Jinesh",
      "rank": 13,
      "ad_account_link": "N/A",
      "ad_status": "N/A",
      "date_of_payment": "2026-07-22",
      "last_message_csm": "27th July",
      "mrr": 800,
      "next_7_days_appt_kpi": 0,
      "page": "none",
      "paid_july": false,
      "special_ad_account_rules": "• No ad account",
      "weekly_report": "Total Leads: N/A - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Lasertronics",
    "fields": {
      "rep_name": "Carl",
      "rank": 7,
      "cpl_4day": 29.72,
      "booking_avg_4day": 0.25,
      "booking_count_4day": 1,
      "lead_count_4day": 4,
      "spend_4day": 118.86,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1554206692783434&business_id=4224681034275407&nav_entry_point=ads_ecosystem_navigation_menu&date=2026-06-29_2026-07-06&comparison_date=&insights_date=2026-06-29_2026-07-06&insights_comparison_date=&nav_source=ads_manager",
      "ad_account_status": "Not Live",
      "ad_status": "Not Live",
      "campaign_doc": "5- Carl (https://app.notion.com/p/5-Carl-3bb24f67814f80bf8996fb0fb22783ae?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-24",
      "henry_comment": "Next week:\n10-15 leads\n2-3 bookings",
      "last_message_csm": "28th July",
      "mrr": 1800,
      "next_7_days_appt_kpi": 5,
      "page": "Lasertronics",
      "paid_july": false,
      "special_ad_account_rules": "• In ad account sanford\n  • His campaign is labelled “Lasertronics”",
      "target_cpl": 40,
      "task": "Get his ads live - session (https://app.notion.com/p/Get-his-ads-live-session-3a924f67814f8015b4f3eb40b89b68c9?pvs=21), Integration Session (https://app.notion.com/p/Integration-Session-3a924f67814f806085d4d6e9d31030de?pvs=21), Lasertronics — Carl email 27 Jul (https://app.notion.com/p/Lasertronics-Carl-email-27-Jul-3ab24f67814f80b19c7cd0991dd0aca8?pvs=21)",
      "weekly_report": "Total Leads: 0 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "SilverLoom",
    "fields": {
      "rep_name": "Anthony",
      "rank": 4,
      "cpl_4day": 37.65,
      "booking_avg_4day": 0.5,
      "booking_count_4day": 2,
      "lead_count_4day": 7,
      "spend_4day": 263.53,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=718995589957678&business_id=718995589957678&act=1235932888264002&redirect_session_id=233d0f3d-a0bf-4e78-b02d-8597c6f14b2b#",
      "ad_account_status": "Live",
      "ad_status": "Not Live",
      "campaign_doc": "6- Anthony (https://app.notion.com/p/6-Anthony-3bb24f67814f80019f3bfb3916e2b3c4?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-23",
      "henry_comment": "Next Week:\n10 leads\n2 bookings",
      "last_message_csm": "28th July",
      "mrr": 1066,
      "next_7_days_appt_kpi": 3,
      "page": "SilverRoom Advisory Group",
      "paid_july": false,
      "target_cpl": 15,
      "task": "Get his ads live session (https://app.notion.com/p/Get-his-ads-live-session-3a924f67814f80a581b7db8da19e88ce?pvs=21), Integration session (https://app.notion.com/p/Integration-session-3a924f67814f8083b9c2ed4b0303cd3e?pvs=21)",
      "weekly_report": "Total Leads: 0 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "BKG Biz Solutions",
    "fields": {
      "rep_name": "Bilal",
      "rank": 5,
      "ad_account_link": "N/A",
      "ad_status": "N/A",
      "campaign_doc": "18 - Bilal (https://app.notion.com/p/18-Bilal-3bb24f67814f80eeb425e9f89cdfffdd?pvs=21)",
      "client_type": "Low Tier - 15 to 20 mins",
      "date_of_payment": "2026-07-27",
      "henry_comment": "Next Week:\n5 bookings",
      "last_message_csm": "28th July",
      "mrr": 1250,
      "page": "none",
      "paid_july": false,
      "special_ad_account_rules": "• No Ad Account",
      "weekly_report": "Total Leads: N/A - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Jim Property Solutions",
    "fields": {
      "rep_name": "Jim",
      "lead_count_4day": 0,
      "spend_4day": 0,
      "ad_status": "N/A",
      "campaign_doc": "7- Jim (https://app.notion.com/p/7-Jim-3bb24f67814f80e4b178d9f9e9a645bf?pvs=21)",
      "client_type": "Secondary - 25-30 Mins",
      "date_of_payment": "2026-07-30",
      "henry_comment": "Next week:\n7 bookings\n20 ledas",
      "last_message_csm": "30th July",
      "page": "cancelled",
      "paid_july": true,
      "weekly_report": "Total Leads: 0 - 31/7\nTotal Bookings: 0"
    }
  },
  {
    "name": "Solar Battery Direct",
    "fields": {
      "rep_name": "Ryan - SBD",
      "rank": 20,
      "cpl_4day": 22.57,
      "booking_avg_4day": 1.25,
      "booking_count_4day": 5,
      "lead_count_4day": 7,
      "spend_4day": 157.97,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=698402602533485&business_id=718995589957678",
      "ad_account_status": "Not Live",
      "client_type": "Primary - 40-50 mins",
      "date_of_payment": "2026-07-22",
      "henry_comment": "Next Week:\n5 calls",
      "page": "Solarcheck",
      "paid_july": false,
      "special_ad_account_rules": "• In ad account Solar Rebate",
      "target_cpl": 40,
      "weekly_report": "Total Leads: 4 - 31/7"
    }
  },
  {
    "name": "Elecsol Electrical",
    "fields": {
      "rep_name": "Ethan",
      "rank": 11,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=199877392876381&business_id=718995589957678&global_scope_id=718995589957678&nav_entry_point=am_global_scope_selector&columns=name%2Cdelivery%2Crecommendations_guidance%2Cresults%2Ccost_per_result%2Cbudget%2Cspend%2Cimpressions%2Creach%2Cfrequency%2Ccpm%2Cactions%3Alink_click%2Cschedule%2Cend_time%2Cattribution_setting%2Cbid%2Clast_significant_edit%2Cquality_score_organic%2Cquality_score_ectr%2Cquality_score_ecvr%2Ccampaign_name&attribution_windows=default",
      "campaign_doc": "1 - Ethan (https://app.notion.com/p/1-Ethan-3bb24f67814f80fda7b0d8278185e03b?pvs=21)",
      "page": "SolarCheck",
      "paid_july": false,
      "special_ad_account_rules": "• In ad account http://S.IO - #2"
    }
  },
  {
    "name": "Total Solar Energy Solution",
    "fields": {
      "rep_name": "Martin",
      "rank": 15,
      "campaign_doc": "11- Martin (https://app.notion.com/p/11-Martin-3bb24f67814f8003974dd035ceeb28e7?pvs=21)",
      "page": "Solar Check",
      "paid_july": false,
      "special_ad_account_rules": "• In ad account Sandford titled : TSES"
    }
  },
  {
    "name": "Morley Hand Carwash & Detailing",
    "fields": {
      "rep_name": "Prince",
      "rank": 19,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/campaigns?nav_entry_point=fbs_ad_account_open_in_ads_manager_button&nav_source=facebook_business_suite&tool=MANAGE_ADS&act=459400153174233&business_id=718995589957678&date=2026-08-12_2026-08-13%2Ctoday",
      "campaign_doc": "10 - Prince (https://app.notion.com/p/10-Prince-3bb24f67814f80fbacddf3de112ead04?pvs=21)",
      "page": "Morley Hand Carwash & Detailing",
      "paid_july": false,
      "special_ad_account_rules": "• In ad account Moreley Car Wash"
    }
  },
  {
    "name": "Elite Gloss Detailers",
    "fields": {
      "rep_name": "Ali",
      "rank": 2,
      "ad_account_link": "https://adsmanager.facebook.com/adsmanager/manage/ads?act=1564227924839188&business_id=718995589957678&global_scope_id=718995589957678&nav_entry_point=am_global_scope_selector&date=2026-02-17_2026-08-14%2Cmaximum&insights_date=2026-02-17_2026-08-14%2Cmaximum&selected_campaign_ids=6947865800827&selected_adset_ids=6955859053627&selected_ad_ids=6955859054227",
      "campaign_doc": "19 -Ali (https://app.notion.com/p/19-Ali-3bb24f67814f800a8e61e994caa622a0?pvs=21)",
      "page": "Elite Gloss Detailers",
      "paid_july": false
    }
  },
  {
    "name": "Sound Lab Music",
    "fields": {
      "rep_name": "Leah",
      "campaign_doc": "21 - Leah (https://app.notion.com/p/21-Leah-3c724f67814f80fd8f64f091bfdb8783?pvs=21)",
      "paid_july": false
    }
  }
];
